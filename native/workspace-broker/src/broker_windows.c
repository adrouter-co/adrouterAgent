#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winternl.h>

#include "broker_platform.h"

#include <limits.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#ifndef NT_SUCCESS
#define NT_SUCCESS(Status) (((NTSTATUS)(Status)) >= 0)
#endif
#ifndef STATUS_OBJECT_NAME_NOT_FOUND
#define STATUS_OBJECT_NAME_NOT_FOUND ((NTSTATUS)0xC0000034L)
#endif
#ifndef STATUS_OBJECT_PATH_NOT_FOUND
#define STATUS_OBJECT_PATH_NOT_FOUND ((NTSTATUS)0xC000003AL)
#endif
#ifndef STATUS_NO_SUCH_FILE
#define STATUS_NO_SUCH_FILE ((NTSTATUS)0xC000000FL)
#endif
#ifndef STATUS_OBJECT_NAME_COLLISION
#define STATUS_OBJECT_NAME_COLLISION ((NTSTATUS)0xC0000035L)
#endif
#ifndef FILE_OPEN
#define FILE_OPEN 0x00000001
#define FILE_CREATE 0x00000002
#define FILE_OPEN_IF 0x00000003
#endif
#ifndef FILE_DIRECTORY_FILE
#define FILE_DIRECTORY_FILE 0x00000001
#define FILE_SYNCHRONOUS_IO_NONALERT 0x00000020
#define FILE_NON_DIRECTORY_FILE 0x00000040
#define FILE_OPEN_REPARSE_POINT 0x00200000
#endif

typedef NTSTATUS(NTAPI *nt_create_file_fn)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES,
                                           PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG,
                                           ULONG, PVOID, ULONG);

static nt_create_file_fn nt_create_file = NULL;
static LONG temporary_sequence = 0;

static int fail_message(char *error, size_t error_size, const char *message) {
  snprintf(error, error_size, "%s", message);
  return 0;
}

static int fail_windows(char *error, size_t error_size, const char *action) {
  snprintf(error, error_size, "%s (Windows error %lu).", action, (unsigned long)GetLastError());
  return 0;
}

static int fail_status(char *error, size_t error_size, const char *action, NTSTATUS status) {
  snprintf(error, error_size, "%s (NT status 0x%08lx).", action, (unsigned long)status);
  return 0;
}

static int ensure_nt_api(char *error, size_t error_size) {
  if (nt_create_file != NULL) return 1;
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (ntdll == NULL) return fail_windows(error, error_size, "Unable to bind ntdll");
  nt_create_file = (nt_create_file_fn)GetProcAddress(ntdll, "NtCreateFile");
  if (nt_create_file == NULL) {
    return fail_windows(error, error_size, "Unable to bind NtCreateFile");
  }
  return 1;
}

static wchar_t *utf8_to_wide(const char *input, char *error, size_t error_size) {
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input, -1, NULL, 0);
  if (length <= 0) {
    fail_windows(error, error_size, "Workspace path is not valid UTF-8");
    return NULL;
  }
  wchar_t *output = (wchar_t *)calloc((size_t)length, sizeof(wchar_t));
  if (output == NULL) {
    fail_message(error, error_size, "Unable to allocate Windows path state.");
    return NULL;
  }
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input, -1, output, length) <= 0) {
    free(output);
    fail_windows(error, error_size, "Unable to decode workspace path");
    return NULL;
  }
  return output;
}

static char *wide_to_utf8(const wchar_t *input, int input_length, char *error,
                          size_t error_size) {
  int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input, input_length, NULL, 0,
                                   NULL, NULL);
  if (length <= 0) {
    fail_windows(error, error_size, "Unable to encode workspace path");
    return NULL;
  }
  char *output = (char *)malloc((size_t)length + 1);
  if (output == NULL) {
    fail_message(error, error_size, "Unable to allocate workspace path.");
    return NULL;
  }
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input, input_length, output, length, NULL,
                          NULL) <= 0) {
    free(output);
    fail_windows(error, error_size, "Unable to encode workspace path");
    return NULL;
  }
  output[length] = '\0';
  return output;
}

static int valid_component(const wchar_t *component) {
  return component[0] != L'\0' && wcscmp(component, L".") != 0 && wcscmp(component, L"..") != 0 &&
         wcschr(component, L'\\') == NULL && wcschr(component, L':') == NULL;
}

static int validate_relative_path(const char *relative_path, int allow_dot, char *error,
                                  size_t error_size) {
  if (relative_path == NULL || relative_path[0] == '\0' || relative_path[0] == '/' ||
      relative_path[0] == '\\' || strstr(relative_path, "//") != NULL ||
      strchr(relative_path, '\\') != NULL || strchr(relative_path, ':') != NULL) {
    return fail_message(error, error_size, "Workspace broker requires a normalized relative path.");
  }
  if (allow_dot && strcmp(relative_path, ".") == 0) return 1;
  if (strcmp(relative_path, ".") == 0 ||
      relative_path[strlen(relative_path) - 1] == '/') {
    return fail_message(error, error_size, "Workspace broker rejected path traversal.");
  }
  return 1;
}

static int is_missing_status(NTSTATUS status) {
  return status == STATUS_OBJECT_NAME_NOT_FOUND || status == STATUS_OBJECT_PATH_NOT_FOUND ||
         status == STATUS_NO_SUCH_FILE;
}

static int assert_not_reparse(HANDLE handle, char *error, size_t error_size) {
  FILE_ATTRIBUTE_TAG_INFO attributes;
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &attributes,
                                    sizeof(attributes))) {
    return fail_windows(error, error_size, "Unable to inspect bound workspace handle");
  }
  if ((attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    return fail_message(error, error_size, "Workspace broker rejects reparse points.");
  }
  return 1;
}

static HANDLE open_root(const char *root, int writable, char *error, size_t error_size) {
  wchar_t *wide_root = utf8_to_wide(root, error, error_size);
  if (wide_root == NULL) return INVALID_HANDLE_VALUE;
  DWORD access = FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE;
  if (writable) access |= FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_DELETE_CHILD;
  HANDLE handle = CreateFileW(
      wide_root, access,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  free(wide_root);
  if (handle == INVALID_HANDLE_VALUE) {
    fail_windows(error, error_size, "Unable to open the workspace root safely");
    return INVALID_HANDLE_VALUE;
  }
  if (!assert_not_reparse(handle, error, error_size)) {
    CloseHandle(handle);
    return INVALID_HANDLE_VALUE;
  }
  return handle;
}

static HANDLE open_relative(HANDLE parent, const wchar_t *name, ACCESS_MASK access,
                            ULONG disposition, ULONG options, NTSTATUS *status, char *error,
                            size_t error_size) {
  if (!ensure_nt_api(error, error_size)) return INVALID_HANDLE_VALUE;
  UNICODE_STRING object_name;
  size_t bytes = wcslen(name) * sizeof(wchar_t);
  if (bytes == 0 || bytes > USHRT_MAX) {
    fail_message(error, error_size, "Workspace path component is invalid.");
    return INVALID_HANDLE_VALUE;
  }
  object_name.Buffer = (PWSTR)name;
  object_name.Length = (USHORT)bytes;
  object_name.MaximumLength = (USHORT)bytes;
  OBJECT_ATTRIBUTES attributes;
  InitializeObjectAttributes(&attributes, &object_name, OBJ_CASE_INSENSITIVE, parent, NULL);
  IO_STATUS_BLOCK io_status;
  HANDLE handle = INVALID_HANDLE_VALUE;
  *status = nt_create_file(
      &handle, access, &attributes, &io_status, NULL, FILE_ATTRIBUTE_NORMAL,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, disposition,
      options | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT, NULL, 0);
  if (!NT_SUCCESS(*status)) return INVALID_HANDLE_VALUE;
  if (!assert_not_reparse(handle, error, error_size)) {
    CloseHandle(handle);
    return INVALID_HANDLE_VALUE;
  }
  return handle;
}

typedef struct {
  HANDLE parent;
  wchar_t *name;
  int missing;
} bound_parent;

static void close_bound_parent(bound_parent *bound) {
  if (bound->parent != NULL && bound->parent != INVALID_HANDLE_VALUE) CloseHandle(bound->parent);
  free(bound->name);
  bound->parent = INVALID_HANDLE_VALUE;
  bound->name = NULL;
}

static int open_parent(const char *root, const char *relative_path, int create_parents,
                       bound_parent *bound, char *error, size_t error_size) {
  memset(bound, 0, sizeof(*bound));
  bound->parent = INVALID_HANDLE_VALUE;
  if (!validate_relative_path(relative_path, 0, error, error_size)) return 0;
  wchar_t *wide_path = utf8_to_wide(relative_path, error, error_size);
  if (wide_path == NULL) return 0;
  HANDLE current = open_root(root, create_parents, error, error_size);
  if (current == INVALID_HANDLE_VALUE) {
    free(wide_path);
    return 0;
  }
  wchar_t *last_separator = wcsrchr(wide_path, L'/');
  wchar_t *base = last_separator == NULL ? wide_path : last_separator + 1;
  if (!valid_component(base)) {
    CloseHandle(current);
    free(wide_path);
    return fail_message(error, error_size, "Workspace broker rejected a malformed filename.");
  }
  if (last_separator != NULL) {
    *last_separator = L'\0';
    wchar_t *context = NULL;
    wchar_t *component = wcstok_s(wide_path, L"/", &context);
    while (component != NULL) {
      if (!valid_component(component)) {
        CloseHandle(current);
        free(wide_path);
        return fail_message(error, error_size, "Workspace broker rejected path traversal.");
      }
      NTSTATUS status = 0;
      ACCESS_MASK directory_access =
          FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE;
      if (create_parents) {
        directory_access |= FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_DELETE_CHILD;
      }
      HANDLE next = open_relative(
          current, component, directory_access,
          create_parents ? FILE_OPEN_IF : FILE_OPEN, FILE_DIRECTORY_FILE, &status, error,
          error_size);
      if (next == INVALID_HANDLE_VALUE) {
        CloseHandle(current);
        free(wide_path);
        if (!create_parents && is_missing_status(status)) {
          bound->missing = 1;
          return 1;
        }
        return fail_status(error, error_size, "Unable to bind workspace directory", status);
      }
      CloseHandle(current);
      current = next;
      component = wcstok_s(NULL, L"/", &context);
    }
  }
  bound->name = _wcsdup(base);
  free(wide_path);
  if (bound->name == NULL) {
    CloseHandle(current);
    return fail_message(error, error_size, "Unable to allocate filename state.");
  }
  bound->parent = current;
  return 1;
}

static int handle_metadata(HANDLE handle, BY_HANDLE_FILE_INFORMATION *metadata, char *error,
                           size_t error_size) {
  if (!GetFileInformationByHandle(handle, metadata)) {
    return fail_windows(error, error_size, "Unable to inspect bound workspace file");
  }
  if ((metadata->dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    return fail_message(error, error_size, "Workspace broker rejects reparse points.");
  }
  return 1;
}

static int read_bound_handle(HANDLE handle, size_t maximum, unsigned char **bytes, size_t *length,
                             char *error, size_t error_size) {
  BY_HANDLE_FILE_INFORMATION metadata;
  if (!handle_metadata(handle, &metadata, error, error_size)) return 0;
  if ((metadata.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
    return fail_message(error, error_size, "Workspace broker accepts only regular files.");
  }
  if (metadata.nNumberOfLinks != 1) {
    return fail_message(error, error_size, "Workspace broker rejects hard-linked files.");
  }
  uint64_t file_size = ((uint64_t)metadata.nFileSizeHigh << 32) | metadata.nFileSizeLow;
  if (file_size > maximum) {
    return fail_message(error, error_size, "Workspace file exceeds the bounded read limit.");
  }
  unsigned char *buffer = file_size == 0 ? NULL : (unsigned char *)malloc((size_t)file_size);
  if (file_size > 0 && buffer == NULL) {
    return fail_message(error, error_size, "Unable to allocate file buffer.");
  }
  LARGE_INTEGER beginning;
  beginning.QuadPart = 0;
  if (!SetFilePointerEx(handle, beginning, NULL, FILE_BEGIN)) {
    free(buffer);
    return fail_windows(error, error_size, "Unable to seek bound workspace file");
  }
  size_t offset = 0;
  while (offset < (size_t)file_size) {
    DWORD chunk = (DWORD)(((size_t)file_size - offset) > 1024 * 1024
                              ? 1024 * 1024
                              : ((size_t)file_size - offset));
    DWORD received = 0;
    if (!ReadFile(handle, buffer + offset, chunk, &received, NULL) || received == 0) {
      free(buffer);
      return fail_windows(error, error_size, "Unable to read bound workspace file");
    }
    offset += received;
  }
  *bytes = buffer;
  *length = (size_t)file_size;
  return 1;
}

static HANDLE open_file_relative(HANDLE parent, const wchar_t *name, ACCESS_MASK access,
                                 ULONG disposition, NTSTATUS *status, char *error,
                                 size_t error_size) {
  return open_relative(parent, name, access, disposition, FILE_NON_DIRECTORY_FILE, status, error,
                       error_size);
}

static int file_matches(HANDLE parent, const wchar_t *name, const unsigned char *expected,
                        size_t expected_length, HANDLE *matched, char *error, size_t error_size) {
  NTSTATUS status = 0;
  HANDLE handle = open_file_relative(parent, name,
                                     FILE_READ_DATA | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
                                     FILE_OPEN, &status, error, error_size);
  if (handle == INVALID_HANDLE_VALUE) {
    return fail_status(error, error_size, "Unable to open reviewed workspace file", status);
  }
  unsigned char *actual = NULL;
  size_t actual_length = 0;
  int ok = read_bound_handle(handle, expected_length, &actual, &actual_length, error, error_size);
  if (ok) {
    ok = actual_length == expected_length &&
         (expected_length == 0 || memcmp(actual, expected, expected_length) == 0);
    if (!ok) fail_message(error, error_size, "Workspace file changed after review.");
  }
  free(actual);
  if (!ok || matched == NULL) {
    CloseHandle(handle);
  } else {
    *matched = handle;
  }
  return ok;
}

int broker_inspect(const char *root, const char *relative_path, broker_path_kind *kind,
                   uint64_t *size, char *error, size_t error_size) {
  bound_parent bound;
  if (!open_parent(root, relative_path, 0, &bound, error, error_size)) return 0;
  if (bound.missing) {
    *kind = BROKER_PATH_MISSING;
    *size = 0;
    return 1;
  }
  NTSTATUS status = 0;
  HANDLE handle = open_relative(
      bound.parent, bound.name, FILE_READ_ATTRIBUTES | FILE_READ_DATA | SYNCHRONIZE, FILE_OPEN, 0,
      &status, error, error_size);
  close_bound_parent(&bound);
  if (handle == INVALID_HANDLE_VALUE && is_missing_status(status)) {
    *kind = BROKER_PATH_MISSING;
    *size = 0;
    return 1;
  }
  if (handle == INVALID_HANDLE_VALUE) {
    return fail_status(error, error_size, "Unable to inspect workspace path", status);
  }
  BY_HANDLE_FILE_INFORMATION metadata;
  if (!handle_metadata(handle, &metadata, error, error_size)) {
    CloseHandle(handle);
    return 0;
  }
  if ((metadata.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
    *kind = BROKER_PATH_DIRECTORY;
    *size = 0;
  } else {
    if (metadata.nNumberOfLinks != 1) {
      CloseHandle(handle);
      return fail_message(error, error_size, "Workspace broker rejects hard-linked files.");
    }
    *kind = BROKER_PATH_FILE;
    *size = ((uint64_t)metadata.nFileSizeHigh << 32) | metadata.nFileSizeLow;
  }
  CloseHandle(handle);
  return 1;
}

int broker_read(const char *root, const char *relative_path, size_t max_bytes,
                unsigned char **bytes, size_t *length, char *error, size_t error_size) {
  bound_parent bound;
  if (!open_parent(root, relative_path, 0, &bound, error, error_size)) return 0;
  if (bound.missing) return fail_message(error, error_size, "Workspace file does not exist.");
  NTSTATUS status = 0;
  HANDLE handle = open_file_relative(bound.parent, bound.name,
                                     FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                                     FILE_OPEN, &status, error, error_size);
  close_bound_parent(&bound);
  if (handle == INVALID_HANDLE_VALUE) {
    return fail_status(error, error_size, "Unable to open workspace file safely", status);
  }
  int ok = read_bound_handle(handle, max_bytes, bytes, length, error, error_size);
  CloseHandle(handle);
  return ok;
}

static int write_all(HANDLE handle, const unsigned char *bytes, size_t length, char *error,
                     size_t error_size) {
  size_t offset = 0;
  while (offset < length) {
    DWORD chunk = (DWORD)((length - offset) > 1024 * 1024 ? 1024 * 1024 : (length - offset));
    DWORD written = 0;
    if (!WriteFile(handle, bytes + offset, chunk, &written, NULL) || written == 0) {
      return fail_windows(error, error_size, "Unable to write workspace file");
    }
    offset += written;
  }
  return FlushFileBuffers(handle)
             ? 1
             : fail_windows(error, error_size, "Unable to flush workspace file");
}

static void delete_temporary(HANDLE handle) {
  FILE_DISPOSITION_INFO disposition;
  disposition.DeleteFile = TRUE;
  SetFileInformationByHandle(handle, FileDispositionInfo, &disposition, sizeof(disposition));
}

int broker_write(const char *root, const char *relative_path,
                 const unsigned char *expected, size_t expected_length, int expects_existing,
                 const unsigned char *replacement, size_t replacement_length,
                 char *error, size_t error_size) {
  bound_parent bound;
  if (!open_parent(root, relative_path, 1, &bound, error, error_size)) return 0;
  if (expects_existing && !file_matches(bound.parent, bound.name, expected, expected_length, NULL,
                                        error, error_size)) {
    close_bound_parent(&bound);
    return 0;
  }
  if (!expects_existing) {
    NTSTATUS existing_status = 0;
    HANDLE existing = open_file_relative(bound.parent, bound.name, FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                                         FILE_OPEN, &existing_status, error, error_size);
    if (existing != INVALID_HANDLE_VALUE) {
      CloseHandle(existing);
      close_bound_parent(&bound);
      return fail_message(error, error_size, "Workspace create target already exists.");
    }
    if (!is_missing_status(existing_status)) {
      close_bound_parent(&bound);
      return fail_status(error, error_size, "Unable to inspect workspace create target",
                         existing_status);
    }
  }

  HANDLE temporary = INVALID_HANDLE_VALUE;
  wchar_t temporary_name[160];
  NTSTATUS status = 0;
  for (int attempt = 0; attempt < 128 && temporary == INVALID_HANDLE_VALUE; attempt += 1) {
    LONG sequence = InterlockedIncrement(&temporary_sequence);
    _snwprintf_s(temporary_name, 160, _TRUNCATE, L".adrouter-broker-%lu-%ld.tmp",
                 (unsigned long)GetCurrentProcessId(), (long)sequence);
    temporary = open_file_relative(
        bound.parent, temporary_name,
        FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE, FILE_CREATE, &status, error,
        error_size);
    if (temporary == INVALID_HANDLE_VALUE && status != STATUS_OBJECT_NAME_COLLISION) break;
  }
  if (temporary == INVALID_HANDLE_VALUE) {
    close_bound_parent(&bound);
    return fail_status(error, error_size, "Unable to create bound workspace staging file", status);
  }
  int ok = write_all(temporary, replacement, replacement_length, error, error_size);
  if (ok && expects_existing) {
    ok = file_matches(bound.parent, bound.name, expected, expected_length, NULL, error, error_size);
  }
  if (ok && !expects_existing) {
    NTSTATUS existing_status = 0;
    HANDLE existing = open_file_relative(bound.parent, bound.name, FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                                         FILE_OPEN, &existing_status, error, error_size);
    if (existing != INVALID_HANDLE_VALUE) {
      CloseHandle(existing);
      ok = fail_message(error, error_size, "Workspace create target changed before commit.");
    } else if (!is_missing_status(existing_status)) {
      ok = fail_status(error, error_size, "Unable to recheck workspace create target",
                       existing_status);
    }
  }
  if (ok) {
    size_t name_bytes = wcslen(bound.name) * sizeof(wchar_t);
    /* Windows requires the buffer to include the full fixed structure in
       addition to the variable-length file name. */
    size_t structure_bytes = sizeof(FILE_RENAME_INFO) + name_bytes;
    FILE_RENAME_INFO *rename = (FILE_RENAME_INFO *)calloc(1, structure_bytes);
    if (rename == NULL) {
      ok = fail_message(error, error_size, "Unable to allocate workspace rename state.");
    } else {
      rename->ReplaceIfExists = expects_existing ? TRUE : FALSE;
      rename->RootDirectory = bound.parent;
      rename->FileNameLength = (DWORD)name_bytes;
      memcpy(rename->FileName, bound.name, name_bytes);
      if (!SetFileInformationByHandle(temporary, FileRenameInfo, rename, (DWORD)structure_bytes)) {
        ok = fail_windows(error, error_size, "Unable to commit bound workspace replacement");
      }
      free(rename);
    }
  }
  if (!ok) delete_temporary(temporary);
  CloseHandle(temporary);
  close_bound_parent(&bound);
  return ok;
}

int broker_delete(const char *root, const char *relative_path,
                  const unsigned char *expected, size_t expected_length,
                  char *error, size_t error_size) {
  bound_parent bound;
  if (!open_parent(root, relative_path, 0, &bound, error, error_size)) return 0;
  if (bound.missing) return fail_message(error, error_size, "Workspace file does not exist.");
  HANDLE matched = INVALID_HANDLE_VALUE;
  if (!file_matches(bound.parent, bound.name, expected, expected_length, &matched, error,
                    error_size)) {
    close_bound_parent(&bound);
    return 0;
  }
  FILE_DISPOSITION_INFO disposition;
  disposition.DeleteFile = TRUE;
  int ok = SetFileInformationByHandle(matched, FileDispositionInfo, &disposition,
                                      sizeof(disposition))
               ? 1
               : fail_windows(error, error_size, "Unable to delete bound workspace file");
  CloseHandle(matched);
  close_bound_parent(&bound);
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
    if (next == NULL) return fail_message(error, error_size, "Unable to allocate listing state.");
    list->paths = next;
    list->capacity = capacity;
  }
  list->paths[list->count] = _strdup(path);
  if (list->paths[list->count] == NULL) {
    return fail_message(error, error_size, "Unable to allocate listing path.");
  }
  list->count += 1;
  return 1;
}

static int walk_directory(HANDLE directory, const char *prefix, path_list *list, char *error,
                          size_t error_size) {
  const DWORD buffer_size = 64 * 1024;
  unsigned char *buffer = (unsigned char *)malloc(buffer_size);
  if (buffer == NULL) return fail_message(error, error_size, "Unable to allocate listing buffer.");
  FILE_INFO_BY_HANDLE_CLASS info_class = FileIdBothDirectoryRestartInfo;
  while (!list->truncated) {
    if (!GetFileInformationByHandleEx(directory, info_class, buffer, buffer_size)) {
      DWORD code = GetLastError();
      if (code == ERROR_NO_MORE_FILES) break;
      free(buffer);
      SetLastError(code);
      return fail_windows(error, error_size, "Unable to enumerate bound workspace directory");
    }
    info_class = FileIdBothDirectoryInfo;
    FILE_ID_BOTH_DIR_INFO *entry = (FILE_ID_BOTH_DIR_INFO *)buffer;
    while (!list->truncated) {
      size_t name_length = entry->FileNameLength / sizeof(wchar_t);
      if (!(name_length == 1 && entry->FileName[0] == L'.') &&
          !(name_length == 2 && entry->FileName[0] == L'.' && entry->FileName[1] == L'.')) {
        if (list->scanned >= list->maximum) {
          list->truncated = 1;
          break;
        }
        list->scanned += 1;
        wchar_t *name = (wchar_t *)calloc(name_length + 1, sizeof(wchar_t));
        if (name == NULL) {
          free(buffer);
          return fail_message(error, error_size, "Unable to allocate listing name.");
        }
        memcpy(name, entry->FileName, entry->FileNameLength);
        NTSTATUS status = 0;
        HANDLE child = open_relative(
            directory, name, FILE_READ_ATTRIBUTES | FILE_READ_DATA | SYNCHRONIZE, FILE_OPEN, 0,
            &status, error, error_size);
        if (child == INVALID_HANDLE_VALUE) {
          if (!is_missing_status(status)) list->rejected = 1;
        } else if (child != INVALID_HANDLE_VALUE) {
          BY_HANDLE_FILE_INFORMATION metadata;
          if (!handle_metadata(child, &metadata, error, error_size)) {
            CloseHandle(child);
            free(name);
            free(buffer);
            return 0;
          }
          char *utf8_name = wide_to_utf8(name, (int)name_length, error, error_size);
          if (utf8_name == NULL) {
            CloseHandle(child);
            free(name);
            free(buffer);
            return 0;
          }
          size_t prefix_length = strlen(prefix);
          size_t child_length = strlen(utf8_name);
          char *relative = (char *)malloc(prefix_length + child_length + 2);
          if (relative == NULL) {
            free(utf8_name);
            CloseHandle(child);
            free(name);
            free(buffer);
            return fail_message(error, error_size, "Unable to allocate listing path.");
          }
          snprintf(relative, prefix_length + child_length + 2, "%s%s%s", prefix,
                   prefix_length == 0 ? "" : "/", utf8_name);
          int ok = 1;
          if ((metadata.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
            ok = walk_directory(child, relative, list, error, error_size);
          } else if (metadata.nNumberOfLinks == 1) {
            ok = append_path(list, relative, error, error_size);
          } else {
            list->rejected = 1;
          }
          free(relative);
          free(utf8_name);
          CloseHandle(child);
          if (!ok) {
            free(name);
            free(buffer);
            return 0;
          }
        }
        free(name);
      }
      if (entry->NextEntryOffset == 0) break;
      entry = (FILE_ID_BOTH_DIR_INFO *)((unsigned char *)entry + entry->NextEntryOffset);
    }
  }
  free(buffer);
  return 1;
}

static int open_listing_root(const char *root, const char *relative_path, HANDLE *directory,
                             char *error, size_t error_size) {
  if (!validate_relative_path(relative_path, 1, error, error_size)) return 0;
  HANDLE current = open_root(root, 0, error, error_size);
  if (current == INVALID_HANDLE_VALUE) return 0;
  if (strcmp(relative_path, ".") == 0) {
    *directory = current;
    return 1;
  }
  wchar_t *wide_path = utf8_to_wide(relative_path, error, error_size);
  if (wide_path == NULL) {
    CloseHandle(current);
    return 0;
  }
  wchar_t *context = NULL;
  wchar_t *component = wcstok_s(wide_path, L"/", &context);
  while (component != NULL) {
    NTSTATUS status = 0;
    HANDLE next = open_relative(
        current, component, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_OPEN,
        FILE_DIRECTORY_FILE, &status, error, error_size);
    if (next == INVALID_HANDLE_VALUE) {
      CloseHandle(current);
      free(wide_path);
      return fail_status(error, error_size, "Unable to bind workspace listing directory", status);
    }
    CloseHandle(current);
    current = next;
    component = wcstok_s(NULL, L"/", &context);
  }
  free(wide_path);
  *directory = current;
  return 1;
}

int broker_list(const char *root, const char *relative_path, size_t max_entries,
                char ***paths, size_t *count, int *truncated, int *rejected,
                char *error, size_t error_size) {
  HANDLE directory = INVALID_HANDLE_VALUE;
  if (!open_listing_root(root, relative_path, &directory, error, error_size)) return 0;
  path_list list;
  memset(&list, 0, sizeof(list));
  list.maximum = max_entries;
  const char *prefix = strcmp(relative_path, ".") == 0 ? "" : relative_path;
  int ok = walk_directory(directory, prefix, &list, error, error_size);
  CloseHandle(directory);
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
