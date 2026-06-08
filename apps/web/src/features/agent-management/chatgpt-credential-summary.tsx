import { Badge } from '~/components/ui/badge'

import type { CredentialMetadata } from './use-credential-metadata'

export function ChatgptCredentialSummary({ credential }: { credential: CredentialMetadata }) {
  const account = credential.chatgpt
  return (
    <div className="rounded-md border border-foreground/8 bg-muted/35 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-muted-foreground">
          ChatGPT account
        </span>
        {account?.chatgptPlanType && (
          <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-medium uppercase">
            {account.chatgptPlanType}
          </Badge>
        )}
      </div>
      <div className="mt-1 truncate font-mono text-[12px] text-foreground">
        {account?.chatgptAccountId ?? credential.maskedSecret}
      </div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">
        {credential.label}
      </div>
    </div>
  )
}
