// Output: Shared lazy loader and preload hook for the new chat route page.
// Input: Tab open and background route preload intent.
// Position: Owned by New Chat so tab registration can avoid cold lazy blanks.

export function loadNewChatPage() {
  return import('~/features/new-chat/new-chat-page').then(module => ({ default: module.NewChatPage }))
}

export function preloadNewChatPage(): void {
  void loadNewChatPage()
}
