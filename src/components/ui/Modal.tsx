import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Bordered content block inside {@link Modal} — matches mappings edit / form modals. */
export function ModalBodyPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`modal-body-panel ${className}`.trim()}>{children}</div>;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Shown in the header; also used for `aria-labelledby`. */
  title?: string;
  /** Muted subtitle under the title. */
  description?: string;
  children: ReactNode;
  /** Extra class on the scrollable panel (width, etc.). */
  panelClassName?: string;
  /** @default true */
  closeOnBackdropClick?: boolean;
  /** @default true */
  showCloseButton?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  panelClassName = '',
  closeOnBackdropClick = true,
  showCloseButton = true,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  /** Avoid [open, onClose] deps: unstable parent callbacks would re-run this every render and steal input focus. */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const focusable = panel.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (focusable ?? panel).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`modal-panel ${panelClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || description || showCloseButton) && (
          <header className="modal-header">
            <div className="modal-header-text">
              {title && (
                <h2 id={titleId} className="modal-title">
                  {title}
                </h2>
              )}
              {description && <p className="modal-description">{description}</p>}
            </div>
            {showCloseButton && (
              <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
                ×
              </button>
            )}
          </header>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
