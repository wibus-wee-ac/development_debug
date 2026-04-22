// Input: all git feature modules
// Output: public API barrel — exports GitPanel and GitBranchControl for use in layout components
// Position: Feature module public API surface; imported by right-aside.tsx and chat route

export { GitBranchControl } from './git-branch-control'
export { GitPanel } from './git-panel'
