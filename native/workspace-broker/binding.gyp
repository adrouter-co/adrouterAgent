{
  "targets": [
    {
      "target_name": "adrouter_workspace_broker",
      "sources": ["src/broker.c"],
      "defines": ["NAPI_VERSION=8"],
      "cflags_c": ["-std=c11"],
      "xcode_settings": {
        "GCC_C_LANGUAGE_STANDARD": "c11",
        "MACOSX_DEPLOYMENT_TARGET": "12.0"
      },
      "conditions": [
        ["OS=='win'", { "sources": ["src/broker_windows.c"] }],
        ["OS!='win'", { "sources": ["src/broker_posix.c"] }]
      ]
    }
  ]
}
