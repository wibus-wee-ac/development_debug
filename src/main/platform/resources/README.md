<!-- Once this directory changes, update this README.md -->

# Main/Platform/Resources

Resources platform bucket 负责开发/生产环境下打包资源的路径解析与读取。
它让 feature 与 app glue 不必重复关心 `resources/` 的定位细节。
把打包资源访问逻辑集中在这里。

## Files

- **bundled-resources.ts**: 打包资源路径与文本资源读取 helpers
