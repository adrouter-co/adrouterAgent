#include <node_api.h>

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "broker_platform.h"

#define BROKER_ERROR_BYTES 512
#define BROKER_MAX_PATH_BYTES 4096
#define BROKER_MAX_FILE_BYTES (10 * 1024 * 1024)
#define BROKER_MAX_LIST_ENTRIES 5000

static napi_value throw_last(napi_env env, const char *message) {
  napi_throw_error(env, "ERR_ADROUTER_WORKSPACE_BROKER", message);
  return NULL;
}

static int read_utf8(napi_env env, napi_value value, char **output) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok ||
      length == 0 || length > BROKER_MAX_PATH_BYTES) {
    return 0;
  }
  char *buffer = (char *)malloc(length + 1);
  if (buffer == NULL) return 0;
  if (napi_get_value_string_utf8(env, value, buffer, length + 1, &length) != napi_ok) {
    free(buffer);
    return 0;
  }
  buffer[length] = '\0';
  *output = buffer;
  return 1;
}

static int get_root_and_path(napi_env env, napi_callback_info info, size_t minimum_args,
                             napi_value *args, char **root, char **relative_path) {
  size_t argc = minimum_args;
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc < minimum_args) {
    throw_last(env, "Workspace broker received an incomplete request.");
    return 0;
  }
  if (!read_utf8(env, args[0], root) || !read_utf8(env, args[1], relative_path)) {
    free(*root);
    free(*relative_path);
    *root = NULL;
    *relative_path = NULL;
    throw_last(env, "Workspace broker paths must be non-empty bounded UTF-8 strings.");
    return 0;
  }
  return 1;
}

static napi_value inspect_path(napi_env env, napi_callback_info info) {
  napi_value args[2];
  char *root = NULL;
  char *relative_path = NULL;
  if (!get_root_and_path(env, info, 2, args, &root, &relative_path)) return NULL;
  char error[BROKER_ERROR_BYTES] = {0};
  broker_path_kind kind = BROKER_PATH_MISSING;
  uint64_t size = 0;
  int ok = broker_inspect(root, relative_path, &kind, &size, error, sizeof(error));
  free(root);
  free(relative_path);
  if (!ok) return throw_last(env, error);

  napi_value result;
  napi_value kind_value;
  napi_value size_value;
  napi_create_object(env, &result);
  const char *kind_text = kind == BROKER_PATH_FILE
                              ? "file"
                              : kind == BROKER_PATH_DIRECTORY ? "directory" : "missing";
  napi_create_string_utf8(env, kind_text, NAPI_AUTO_LENGTH, &kind_value);
  napi_create_double(env, (double)size, &size_value);
  napi_set_named_property(env, result, "kind", kind_value);
  napi_set_named_property(env, result, "size", size_value);
  return result;
}

static napi_value read_file(napi_env env, napi_callback_info info) {
  napi_value args[3];
  char *root = NULL;
  char *relative_path = NULL;
  if (!get_root_and_path(env, info, 3, args, &root, &relative_path)) return NULL;
  uint32_t requested_limit = 0;
  if (napi_get_value_uint32(env, args[2], &requested_limit) != napi_ok || requested_limit == 0 ||
      requested_limit > BROKER_MAX_FILE_BYTES) {
    free(root);
    free(relative_path);
    return throw_last(env, "Workspace broker read limit is invalid.");
  }
  char error[BROKER_ERROR_BYTES] = {0};
  unsigned char *bytes = NULL;
  size_t length = 0;
  int ok = broker_read(root, relative_path, requested_limit, &bytes, &length, error, sizeof(error));
  free(root);
  free(relative_path);
  if (!ok) {
    free(bytes);
    return throw_last(env, error);
  }
  napi_value result;
  napi_create_buffer_copy(env, length, bytes, NULL, &result);
  free(bytes);
  return result;
}

static int get_buffer(napi_env env, napi_value value, unsigned char **bytes, size_t *length) {
  bool is_buffer = false;
  if (napi_is_buffer(env, value, &is_buffer) != napi_ok || !is_buffer) return 0;
  void *data = NULL;
  if (napi_get_buffer_info(env, value, &data, length) != napi_ok ||
      *length > BROKER_MAX_FILE_BYTES) {
    return 0;
  }
  *bytes = (unsigned char *)data;
  return 1;
}

static napi_value replace_file(napi_env env, napi_callback_info info) {
  napi_value args[4];
  char *root = NULL;
  char *relative_path = NULL;
  if (!get_root_and_path(env, info, 4, args, &root, &relative_path)) return NULL;
  napi_valuetype expected_type;
  napi_typeof(env, args[2], &expected_type);
  int expects_existing = expected_type != napi_null;
  unsigned char *expected = NULL;
  size_t expected_length = 0;
  unsigned char *replacement = NULL;
  size_t replacement_length = 0;
  if ((expects_existing && !get_buffer(env, args[2], &expected, &expected_length)) ||
      !get_buffer(env, args[3], &replacement, &replacement_length)) {
    free(root);
    free(relative_path);
    return throw_last(env, "Workspace broker replacement buffers are invalid or oversized.");
  }
  char error[BROKER_ERROR_BYTES] = {0};
  int ok = broker_write(root, relative_path, expected, expected_length, expects_existing,
                        replacement, replacement_length, error, sizeof(error));
  free(root);
  free(relative_path);
  if (!ok) return throw_last(env, error);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value delete_file(napi_env env, napi_callback_info info) {
  napi_value args[3];
  char *root = NULL;
  char *relative_path = NULL;
  if (!get_root_and_path(env, info, 3, args, &root, &relative_path)) return NULL;
  unsigned char *expected = NULL;
  size_t expected_length = 0;
  if (!get_buffer(env, args[2], &expected, &expected_length)) {
    free(root);
    free(relative_path);
    return throw_last(env, "Workspace broker deletion buffer is invalid or oversized.");
  }
  char error[BROKER_ERROR_BYTES] = {0};
  int ok = broker_delete(root, relative_path, expected, expected_length, error, sizeof(error));
  free(root);
  free(relative_path);
  if (!ok) return throw_last(env, error);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value list_files(napi_env env, napi_callback_info info) {
  napi_value args[3];
  char *root = NULL;
  char *relative_path = NULL;
  if (!get_root_and_path(env, info, 3, args, &root, &relative_path)) return NULL;
  uint32_t requested_limit = 0;
  if (napi_get_value_uint32(env, args[2], &requested_limit) != napi_ok || requested_limit == 0 ||
      requested_limit > BROKER_MAX_LIST_ENTRIES) {
    free(root);
    free(relative_path);
    return throw_last(env, "Workspace broker listing limit is invalid.");
  }
  char error[BROKER_ERROR_BYTES] = {0};
  char **paths = NULL;
  size_t count = 0;
  int truncated = 0;
  int rejected = 0;
  int ok = broker_list(root, relative_path, requested_limit, &paths, &count, &truncated, &rejected,
                       error, sizeof(error));
  free(root);
  free(relative_path);
  if (!ok) {
    broker_free_list(paths, count);
    return throw_last(env, error);
  }

  napi_value result;
  napi_value files;
  napi_value truncated_value;
  napi_value rejected_value;
  napi_create_object(env, &result);
  napi_create_array_with_length(env, count, &files);
  for (size_t index = 0; index < count; index += 1) {
    napi_value path_value;
    napi_create_string_utf8(env, paths[index], NAPI_AUTO_LENGTH, &path_value);
    napi_set_element(env, files, (uint32_t)index, path_value);
  }
  napi_get_boolean(env, truncated != 0, &truncated_value);
  napi_get_boolean(env, rejected != 0, &rejected_value);
  napi_set_named_property(env, result, "files", files);
  napi_set_named_property(env, result, "truncated", truncated_value);
  napi_set_named_property(env, result, "rejected", rejected_value);
  broker_free_list(paths, count);
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"inspectPath", NULL, inspect_path, NULL, NULL, NULL, napi_default, NULL},
      {"readFile", NULL, read_file, NULL, NULL, NULL, napi_default, NULL},
      {"replaceFile", NULL, replace_file, NULL, NULL, NULL, napi_default, NULL},
      {"deleteFile", NULL, delete_file, NULL, NULL, NULL, napi_default, NULL},
      {"listFiles", NULL, list_files, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
