'use client'

import { Popover } from '@base-ui/react/popover'

/** shadcn/ui-style popover on Base UI (shadcn's default primitives since 2026-07). */
export function PopoverDemo() {
  return (
    <Popover.Root>
      <Popover.Trigger className="rounded-md border px-3 py-1 data-popup-open:bg-zinc-100">
        Open popover
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4}>
          <Popover.Popup className="w-72 rounded-md border bg-white p-4 shadow-md data-open:ring-2 data-closed:opacity-0">
            Popover content
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
