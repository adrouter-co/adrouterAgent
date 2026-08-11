#define _POSIX_C_SOURCE 200809L
#ifdef __APPLE__
#define _DARWIN_C_SOURCE
#endif

#include "broker_platform.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef O_CLOEXEC
#define O_CLOEXEC 0
#endif
#ifndef O_NOFOLLOW
#error "The descriptor-bound workspace broker requires O_NOFOLLOW."
#endif

static atomic_ulong temporary_sequence = 1;

static int fail_errno(char *error, size_t error_size, const char *action) {
  snprintf(error, error_size, "%s: %s", action, strerror(errno));
  return 0;
}

static int fail_message(char *error, size_t error_size, const char *message) {
  snprintf(error, error_size, "%s", message);
  return 0;
}

static int valid_component(const char *component) {
  return component[0] != '\0' && strcmp(component, ".") != 0 && strcmp(component, "..") != 0 &&
         strchr(component, '\\') == NULL;
}

static int validate_relative_path(const char *relative_path, int allow_dot, char *error,
                                  size_t error_size) {
  if (relative_path == NULL || relative_path[0] == '\0' || relative_path[0] == '/' ||
      (!allow_dot && strcmp(relative_path, ".") == 0)) {
    return fail_message(error, error_size, "Workspace broker requires a relative path.");
  }
  if (allow_dot && strcmp(relative_path, ".") == 0) return 1;
  char *copy = strdup(relative_path);
  if (copy == NULL) return fail_errno(error, error_size, "Unable to allocate path state");
  char *save = NULL;
  char *component = strtok_r(copy, "/", &save);
  int count = 0;
  while (component != NULL) {
    if (!valid_component(component)) {
      free(copy);
      return fail_message(error, error_size, "Workspace broker rejected path traversal.");
    }
    count += 1;
    component = strtok_r(NULL, "/", &save);
  }
  free(copy);
  if (count == 0 || strstr(relative_path, "//") != NULL ||
      relative_path[strlen(relative_path) - 1] == '/') {
    return fail_message(error, error_size, "Workspace broker rejected a malformed path.");
  }
  return 1;
}

static int open_root(const char *root, char *error, size_t error_size) {
  int fd = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) {
    fail_errno(error, error_size, "Unable to open the workspace root safely");
    return -1;
  }
  struct stat metadata;
  if (fstat(fd, &metadata) != 0 || !S_ISDIR(metadata.st_mode)) {
    close(fd);
    fail_message(error, error_size, "Workspace root is not a bound directory.");
    return -1;
  }
  return fd;
}

static int open_child_directory(int parent, const char *name, int create, int *missing,
                                char *error, size_t error_size) {
  int fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0 && errno == ENOENT && create) {
    if (mkdirat(parent, name, 0700) != 0 && errno != EEXIST) {
      fail_errno(error, error_size, "Unable to create a workspace directory safely");
      return -1;
    }
    fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  }
  if (fd < 0 && errno == ENOENT) {
    *missing = 1;
    return -1;
  }
  if (fd < 0) {
    fail_errno(error, error_size, "Unable to bind a workspace directory");
    return -1;
  }
  return fd;
}

static int open_parent(const char *root, const char *relative_path, int create_parents,
                       int *parent_fd, char **name, int *missing, char *error,
                       size_t error_size) {
  *parent_fd = -1;
  *name = NULL;
  *missing = 0;
  if (!validate_relative_path(relative_path, 0, error, error_size)) return 0;
  int current = open_root(root, error, error_size);
  if (current < 0) return 0;
  char *copy = strdup(relative_path);
  if (copy == NULL) {
    close(current);
    return fail_errno(error, error_size, "Unable to allocate path state");
  }
  char *last_separator = strrchr(copy, '/');
  char *base = last_separator == NULL ? copy : last_separator + 1;
  if (!valid_component(base)) {
    close(current);
    free(copy);
    return fail_message(error, error_size, "Workspace broker rejected a malformed filename.");
  }
  if (last_separator != NULL) {
    *last_separator = '\0';
    char *save = NULL;
    char *component = strtok_r(copy, "/", &save);
    while (component != NULL) {
      int next = open_child_directory(current, component, create_parents, missing, error, error_size);
      if (next < 0) {
        close(current);
        free(copy);
        return *missing ? 1 : 0;
      }
      close(current);
      current = next;
      component = strtok_r(NULL, "/", &save);
    }
  }
  *name = strdup(base);
  free(copy);
  if (*name == NULL) {
    close(current);
    return fail_errno(error, error_size, "Unable to allocate filename state");
  }
  *parent_fd = current;
  return 1;
}

static int assert_regular_file(int fd, size_t maximum, struct stat *metadata, char *error,
                               size_t error_size) {
  if (fstat(fd, metadata) != 0) return fail_errno(error, error_size, "Unable to inspect file");
  if (!S_ISREG(metadata->st_mode)) {
    return fail_message(error, error_size, "Workspace broker accepts only regular files.");
  }
  if (metadata->st_nlink != 1) {
    return fail_message(error, error_size, "Workspace broker rejects hard-linked files.");
  }
  if (metadata->st_size < 0 || (uint64_t)metadata->st_size > maximum) {
    return fail_message(error, error_size, "Workspace file exceeds the bounded read limit.");
  }
  return 1;
}

static int read_bound_fd(int fd, size_t maximum, unsigned char **bytes, size_t *length,
                         char *error, size_t error_size) {
  struct stat metadata;
  if (!assert_regular_file(fd, maximum, &metadata, error, error_size)) return 0;
  size_t size = (size_t)metadata.st_size;
  unsigned char *buffer = size == 0 ? NULL : (unsigned char *)malloc(size);
  if (size > 0 && buffer == NULL) return fail_errno(error, error_size, "Unable to allocate file buffer");
  size_t offset = 0;
  while (offset < size) {
    ssize_t count = pread(fd, buffer + offset, size - offset, (off_t)offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) {
      free(buffer);
      return fail_errno(error, error_size, "Unable to read the bound workspace file");
    }
    offset += (size_t)count;
  }
  struct stat after;
  if (fstat(fd, &after) != 0 || after.st_dev != metadata.st_dev || after.st_ino != metadata.st_ino ||
      after.st_size != metadata.st_size) {
    free(buffer);
    return fail_message(error, error_size, "Workspace file changed during the bound read.");
  }
  *bytes = buffer;
  *length = size;
  return 1;
}

static int file_matches_at(int parent, const char *name, const unsigned char *expected,
                           size_t expected_length, char *error, size_t error_size) {
  int fd = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return fail_errno(error, error_size, "Unable to open the reviewed workspace file");
  unsigned char *actual = NULL;
  size_t actual_length = 0;
  int ok = read_bound_fd(fd, expected_length, &actual, &actual_length, error, error_size);
  close(fd);
  if (!ok) {
    free(actual);
    return 0;
  }
  ok = actual_length == expected_length &&
       (expected_length == 0 || memcmp(actual, expected, expected_length) == 0);
  free(actual);
  if (!ok) return fail_message(error, error_size, "Workspace file changed after review.");
  return 1;
}

int broker_inspect(const char *root, const char *relative_path, broker_path_kind *kind,
                   uint64_t *size, char *error, size_t error_size) {
  int parent = -1;
  char *name = NULL;
  int missing = 0;
  if (!open_parent(root, relative_path, 0, &parent, &name, &missing, error, error_size)) return 0;
  if (missing) {
    *kind = BROKER_PATH_MISSING;
    *size = 0;
    return 1;
  }
  struct stat metadata;
  if (fstatat(parent, name, &metadata, AT_SYMLINK_NOFOLLOW) != 0) {
    if (errno == ENOENT) {
      *kind = BROKER_PATH_MISSING;
      *size = 0;
      close(parent);
      free(name);
      return 1;
    }
    close(parent);
    free(name);
    return fail_errno(error, error_size, "Unable to inspect workspace path");
  }
  if (S_ISLNK(metadata.st_mode)) {
    close(parent);
    free(name);
    return fail_message(error, error_size, "Workspace broker rejects symbolic links.");
  }
  if (S_ISREG(metadata.st_mode) && metadata.st_nlink != 1) {
    close(parent);
    free(name);
    return fail_message(error, error_size, "Workspace broker rejects hard-linked files.");
  }
  *kind = S_ISREG(metadata.st_mode)
              ? BROKER_PATH_FILE
              : S_ISDIR(metadata.st_mode) ? BROKER_PATH_DIRECTORY : BROKER_PATH_MISSING;
  *size = S_ISREG(metadata.st_mode) && metadata.st_size > 0 ? (uint64_t)metadata.st_size : 0;
  close(parent);
  free(name);
  if (*kind == BROKER_PATH_MISSING) {
    return fail_message(error, error_size, "Workspace broker accepts only files and directories.");
  }
  return 1;
}

int broker_read(const char *root, const char *relative_path, size_t max_bytes,
                unsigned char **bytes, size_t *length, char *error, size_t error_size) {
  int parent = -1;
  char *name = NULL;
  int missing = 0;
  if (!open_parent(root, relative_path, 0, &parent, &name, &missing, error, error_size)) return 0;
  if (missing) return fail_message(error, error_size, "The requested workspace file does not exist.");
  int fd = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  close(parent);
  free(name);
  if (fd < 0) return fail_errno(error, error_size, "Unable to open workspace file safely");
  int ok = read_bound_fd(fd, max_bytes, bytes, length, error, error_size);
  close(fd);
  return ok;
}

static int write_all(int fd, const unsigned char *bytes, size_t length, char *error,
                     size_t error_size) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = write(fd, bytes + offset, length - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return fail_errno(error, error_size, "Unable to write workspace file");
    offset += (size_t)count;
  }
  if (fsync(fd) != 0) return fail_errno(error, error_size, "Unable to flush workspace file");
  return 1;
}

int broker_write(const char *root, const char *relative_path,
                 const unsigned char *expected, size_t expected_length, int expects_existing,
                 const unsigned char *replacement, size_t replacement_length,
                 char *error, size_t error_size) {
  int parent = -1;
  char *name = NULL;
  int missing_parent = 0;
  if (!open_parent(root, relative_path, 1, &parent, &name, &missing_parent, error, error_size)) return 0;
  if (expects_existing) {
    if (!file_matches_at(parent, name, expected, expected_length, error, error_size)) {
      close(parent);
      free(name);
      return 0;
    }
  } else {
    struct stat existing;
    if (fstatat(parent, name, &existing, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT) {
      close(parent);
      free(name);
      return fail_message(error, error_size, "Workspace create target already exists.");
    }
  }

  char temporary[160];
  int temporary_fd = -1;
  for (int attempt = 0; attempt < 128 && temporary_fd < 0; attempt += 1) {
    unsigned long sequence = atomic_fetch_add(&temporary_sequence, 1);
    snprintf(temporary, sizeof(temporary), ".adrouter-broker-%ld-%lu.tmp", (long)getpid(), sequence);
    temporary_fd = openat(parent, temporary,
                          O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (temporary_fd < 0 && errno != EEXIST) break;
  }
  if (temporary_fd < 0) {
    close(parent);
    free(name);
    return fail_errno(error, error_size, "Unable to create a bound workspace staging file");
  }
  int ok = write_all(temporary_fd, replacement, replacement_length, error, error_size);
  close(temporary_fd);
  if (ok && expects_existing) {
    ok = file_matches_at(parent, name, expected, expected_length, error, error_size);
  }
  if (ok && !expects_existing) {
    struct stat existing;
    if (fstatat(parent, name, &existing, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT) {
      ok = fail_message(error, error_size, "Workspace create target changed before commit.");
    }
  }
  if (ok && renameat(parent, temporary, parent, name) != 0) {
    ok = fail_errno(error, error_size, "Unable to commit the bound workspace replacement");
  }
  if (!ok) unlinkat(parent, temporary, 0);
  close(parent);
  free(name);
  return ok;
}

int broker_delete(const char *root, const char *relative_path,
                  const unsigned char *expected, size_t expected_length,
                  char *error, size_t error_size) {
  int parent = -1;
  char *name = NULL;
  int missing = 0;
  if (!open_parent(root, relative_path, 0, &parent, &name, &missing, error, error_size)) return 0;
  if (missing) {
    close(parent);
    free(name);
    return fail_message(error, error_size, "Workspace file does not exist.");
  }
  if (!file_matches_at(parent, name, expected, expected_length, error, error_size)) {
    close(parent);
    free(name);
    return 0;
  }
  int ok = unlinkat(parent, name, 0) == 0;
  if (!ok) fail_errno(error, error_size, "Unable to delete the bound workspace file");
  close(parent);
  free(name);
  return ok;
}

typedef struct {
  char **paths;
  size_t count;
  size_t capacity;
  size_t maximum;
  size_t scanned;
  int truncated;
  int rejected;
} path_list;

static int compare_paths(const void *left, const void *right) {
  return strcmp(*(const char *const *)left, *(const char *const *)right);
}

static int append_path(path_list *list, const char *path, char *error, size_t error_size) {
  if (list->count >= list->maximum) {
    list->truncated = 1;
    return 1;
  }
  if (list->count == list->capacity) {
    size_t capacity = list->capacity == 0 ? 64 : list->capacity * 2;
    if (capacity > list->maximum) capacity = list->maximum;
    char **next = (char **)realloc(list->paths, capacity * sizeof(char *));
    if (next == NULL) return fail_errno(error, error_size, "Unable to allocate listing state");
    list->paths = next;
    list->capacity = capacity;
  }
  list->paths[list->count] = strdup(path);
  if (list->paths[list->count] == NULL) {
    return fail_errno(error, error_size, "Unable to allocate listing path");
  }
  list->count += 1;
  return 1;
}

static int walk_directory(int directory_fd, const char *prefix, path_list *list, char *error,
                          size_t error_size) {
  int duplicate = dup(directory_fd);
  if (duplicate < 0) return fail_errno(error, error_size, "Unable to bind directory listing");
  DIR *directory = fdopendir(duplicate);
  if (directory == NULL) {
    close(duplicate);
    return fail_errno(error, error_size, "Unable to open bound directory listing");
  }
  struct dirent *entry;
  while (!list->truncated && (entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    if (list->scanned >= list->maximum) {
      list->truncated = 1;
      break;
    }
    list->scanned += 1;
    int child = openat(directory_fd, entry->d_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (child < 0) {
      if (errno == ELOOP) {
        list->rejected = 1;
        continue;
      }
      if (errno == ENOENT) continue;
      closedir(directory);
      return fail_errno(error, error_size, "Unable to bind workspace listing entry");
    }
    struct stat metadata;
    if (fstat(child, &metadata) != 0) {
      close(child);
      closedir(directory);
      return fail_errno(error, error_size, "Unable to inspect workspace listing entry");
    }
    size_t prefix_length = strlen(prefix);
    size_t name_length = strlen(entry->d_name);
    char *relative = (char *)malloc(prefix_length + name_length + 2);
    if (relative == NULL) {
      close(child);
      closedir(directory);
      return fail_errno(error, error_size, "Unable to allocate listing path");
    }
    snprintf(relative, prefix_length + name_length + 2, "%s%s%s", prefix,
             prefix_length == 0 ? "" : "/", entry->d_name);
    int ok = 1;
    if (S_ISDIR(metadata.st_mode)) {
      ok = walk_directory(child, relative, list, error, error_size);
    } else if (S_ISREG(metadata.st_mode) && metadata.st_nlink == 1) {
      ok = append_path(list, relative, error, error_size);
    } else {
      list->rejected = 1;
    }
    free(relative);
    close(child);
    if (!ok) {
      closedir(directory);
      return 0;
    }
  }
  closedir(directory);
  return 1;
}

static int open_listing_root(const char *root, const char *relative_path, int *directory_fd,
                             char *error, size_t error_size) {
  if (!validate_relative_path(relative_path, 1, error, error_size)) return 0;
  int current = open_root(root, error, error_size);
  if (current < 0) return 0;
  if (strcmp(relative_path, ".") == 0) {
    *directory_fd = current;
    return 1;
  }
  char *copy = strdup(relative_path);
  if (copy == NULL) {
    close(current);
    return fail_errno(error, error_size, "Unable to allocate listing state");
  }
  char *save = NULL;
  char *component = strtok_r(copy, "/", &save);
  while (component != NULL) {
    int missing = 0;
    int next = open_child_directory(current, component, 0, &missing, error, error_size);
    if (next < 0) {
      close(current);
      free(copy);
      if (missing) return fail_message(error, error_size, "Workspace listing path does not exist.");
      return 0;
    }
    close(current);
    current = next;
    component = strtok_r(NULL, "/", &save);
  }
  free(copy);
  *directory_fd = current;
  return 1;
}

int broker_list(const char *root, const char *relative_path, size_t max_entries,
                char ***paths, size_t *count, int *truncated, int *rejected,
                char *error, size_t error_size) {
  int directory = -1;
  if (!open_listing_root(root, relative_path, &directory, error, error_size)) return 0;
  path_list list = {.paths = NULL,
                    .count = 0,
                    .capacity = 0,
                    .maximum = max_entries,
                    .scanned = 0,
                    .truncated = 0,
                    .rejected = 0};
  const char *prefix = strcmp(relative_path, ".") == 0 ? "" : relative_path;
  int ok = walk_directory(directory, prefix, &list, error, error_size);
  close(directory);
  if (!ok) {
    broker_free_list(list.paths, list.count);
    return 0;
  }
  qsort(list.paths, list.count, sizeof(char *), compare_paths);
  *paths = list.paths;
  *count = list.count;
  *truncated = list.truncated;
  *rejected = list.rejected;
  return 1;
}

void broker_free_list(char **paths, size_t count) {
  if (paths == NULL) return;
  for (size_t index = 0; index < count; index += 1) free(paths[index]);
  free(paths);
}
