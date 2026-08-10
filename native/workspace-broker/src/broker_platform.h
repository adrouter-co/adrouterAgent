#ifndef ADROUTER_WORKSPACE_BROKER_PLATFORM_H
#define ADROUTER_WORKSPACE_BROKER_PLATFORM_H

#include <stddef.h>
#include <stdint.h>

typedef enum {
  BROKER_PATH_MISSING = 0,
  BROKER_PATH_FILE = 1,
  BROKER_PATH_DIRECTORY = 2
} broker_path_kind;

int broker_inspect(const char *root, const char *relative_path, broker_path_kind *kind,
                   uint64_t *size, char *error, size_t error_size);
int broker_read(const char *root, const char *relative_path, size_t max_bytes,
                unsigned char **bytes, size_t *length, char *error, size_t error_size);
int broker_write(const char *root, const char *relative_path,
                 const unsigned char *expected, size_t expected_length, int expects_existing,
                 const unsigned char *replacement, size_t replacement_length,
                 char *error, size_t error_size);
int broker_delete(const char *root, const char *relative_path,
                  const unsigned char *expected, size_t expected_length,
                  char *error, size_t error_size);
int broker_list(const char *root, const char *relative_path, size_t max_entries,
                char ***paths, size_t *count, int *truncated, int *rejected,
                char *error, size_t error_size);
void broker_free_list(char **paths, size_t count);

#endif
