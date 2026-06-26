'use client';

// ============================================================
// ConfirmDialog — the app-standard confirmation modal.
//
// Every destructive or otherwise-irreversible action (delete,
// archive, revoke, transfer) must route through a confirmation
// modal rather than the native `window.confirm`, which can't be
// styled, isn't keyboard/screen-reader consistent across browsers,
// and is blocked in some embedded contexts.
//
// Controlled usage:
//
//   const [target, setTarget] = useState<Row | null>(null);
//   ...
//   <ConfirmDialog
//     open={target !== null}
//     onOpenChange={(o) => !o && setTarget(null)}
//     title={`Delete "${target?.label}"?`}
//     description="This can't be undone."
//     confirmLabel="Delete"
//     destructive
//     loading={deleting}
//     onConfirm={handleConfirmDelete}
//   />
// ============================================================

import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Confirm button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Render the confirm button in the destructive (red) variant. */
  destructive?: boolean;
  /** Disables both buttons and shows a spinner on confirm. */
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-muted-foreground">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
