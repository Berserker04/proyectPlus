export type ToastMessage = {
  id: string;
  tone: "info" | "success" | "error";
  message: string;
  detail?: string | null;
  exiting?: boolean;
};

interface ToastContainerProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.tone} ${toast.exiting ? "toast-exiting" : ""}`}
        >
          <div className="toast-content">
            <span className="toast-message">{toast.message}</span>
            {toast.detail && <span className="toast-detail">{toast.detail}</span>}
          </div>
          <button className="toast-close" onClick={() => onRemove(toast.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
