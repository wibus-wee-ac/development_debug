<!-- Once this directory changes, update this README.md -->

# Main/Application/Tests

应用层测试验证跨模块编排行为和事务边界约束。
测试关注 use case 输入输出，不依赖 Electron 运行时。
当新增应用服务时，先在这里定义失败测试再实现。

## Files

- **issue-delegation-application.test.ts**: Issue 委派应用服务的状态流转与 runner 协调测试
