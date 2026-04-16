# AGENTS

This file provides guidance to Agent when working with code in this repository.

## CRITICAL RULES

### 1. Styling - NO Dynamic Tailwind Classes

**All Tailwind classes MUST be statically defined. Never construct class names dynamically:**

```tsx
// ❌ WRONG - Dynamic class construction
const size = 'large'
const className = `text-${size}`  // Won't work with Tailwind purging!

const color = 'blue'
const className = `bg-${color}-500`  // Won't work!

// ✅ CORRECT - Static classes with conditional logic
import { cn } from '@/lib/utils'

const className = cn({
  'text-base': size === 'small',
  'text-lg': size === 'medium',
  'text-xl': size === 'large',
})

// ✅ CORRECT - Predefined class mappings
const sizeClasses = {
  small: 'text-base',
  medium: 'text-lg',
  large: 'text-xl',
}
const className = sizeClasses[size]
```

**Always use the `cn()` utility from `@/lib/utils` for combining classes:**

```tsx
import { cn } from '@/lib/utils'

function Button({ className, variant = 'primary', ...props }) {
  return (
    <button
      className={cn(
        // Base styles
        'px-4 py-2 rounded-md font-medium transition-colors',
        // Variant styles
        {
          'bg-primary text-white hover:bg-primary/90': variant === 'primary',
          'bg-secondary text-secondary-foreground': variant === 'secondary',
        },
        // External className override
        className
      )}
      {...props}
    />
  )
}
```

### 2. Frontend Component Organization - Domain-Based Structure

**Components are organized by reusability and domain:**

- **`components/ui/`** - Universal base UI components
  - Reusable primitives (buttons, inputs, modals)
  - Can be used in any React application
  - Pure UI components without business logic
  - Examples: `Button`, `Input`, `Select`, `Tooltip`

- **`components/common/`** - App-specific shared components
  - Used across multiple features but specific to this app
  - Contains app-specific logic
  - Examples: `ErrorElement`, `Footer`, `AppHeader`

- **`features/{domain}/`** - Feature-specific components
  - Components specific to a business domain/feature
  - Contains domain-specific logic or data handling
  - Examples: `features/feed/`, `features/auth/`, `features/user/`

**Placement rule**: If a component is specific to a business domain/feature, place it in the corresponding module directory.


### Creating a Styled Component with Variants

```tsx
import { cn } from '@/lib/utils'

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        // Base styles
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2',
        'disabled:pointer-events-none disabled:opacity-50',

        // Size variants
        {
          'h-8 px-3 text-sm': size === 'sm',
          'h-10 px-4': size === 'md',
          'h-12 px-6 text-lg': size === 'lg',
        },

        // Color variants
        {
          'bg-primary text-white hover:bg-primary/90': variant === 'primary',
          'bg-secondary text-secondary-foreground hover:bg-secondary/80': variant === 'secondary',
          'border border-border bg-background hover:bg-fill': variant === 'outline',
        },

        className
      )}
      {...props}
    />
  )
}
```

## File and Directory Documentation Requirements

**CRITICAL**: Every file and directory MUST have proper documentation to maintain codebase clarity.

### Directory Documentation (`README.md`)

Every directory (except `bindings/`, which is auto-generated) MUST have a `README.md` with:

1. **Architecture Summary** (3 lines max):
   - Purpose of this directory
   - How it fits in the overall system
   - Key patterns or conventions

2. **File Inventory**:
   - List each file with its name, role, and function
   - Format: `- **filename.ext**: Role description`

3. **Update Reminder**:
   ```markdown
   <!-- Once this directory changes, update this README.md -->
   ```

Example `README.md`:
```markdown
<!-- Once this directory changes, update this README.md -->

# Components/Common

App-specific shared components used across multiple features.
These components contain app-specific logic but are reusable.
Place universal UI components in `components/ui/` instead.

## Files

- **ErrorElement.tsx**: Error boundary component for route errors
- **Footer.tsx**: Application footer with links and metadata
- **AppHeader.tsx**: Main navigation header with theme switcher
```

### File Documentation (Header Comments)

Every `.ts`, `.tsx`, `.js`, `.jsx` file MUST start with a 3-line header comment:

```typescript
// Input: [What this file depends on - external APIs, atoms, services, etc.]
// Output: [What this file exports - components, hooks, utilities, types, etc.]
// Position: [Role in the system - entry point, shared utility, feature component, etc.]
```

After any file modification, you MUST:
1. Update the file's header comment if its role changed
2. Update the parent directory's `README.md` if files were added/removed/changed

Example file header:
```typescript
// Input: useAtomValue from jotai, userAtom from @/atoms/user
// Output: UserProfile component displaying user information
// Position: Feature component in user module

import { useAtomValue } from 'jotai'
import { userAtom } from '@/atoms/user'

export function UserProfile() {
  // ...
}
```

### Enforcement

- **Before committing**: Ensure all new files have header comments
- **Before committing**: Ensure modified directories have updated `README.md`
- **During code review**: Check for missing or outdated documentation
- **When refactoring**: Update all affected file headers and directory READMEs

This documentation system ensures every developer can quickly understand:
- What a file does (Output)
- What it depends on (Input)
- Where it fits in the architecture (Position)
- What's in a directory (README.md file inventory)