import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidthClass?: string;
}

export function ModalSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidthClass = 'sm:max-w-lg',
}: ModalSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-sheet-title"
    >
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl border border-slate-200 sm:rounded-2xl ${maxWidthClass}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-6">
          <div className="min-w-0">
            <h2
              id="modal-sheet-title"
              className="text-base font-semibold text-slate-900 leading-6"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="-mr-2 -mt-1 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>

        {footer ? (
          <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
