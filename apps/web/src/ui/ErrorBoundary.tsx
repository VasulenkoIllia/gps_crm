import { Button, Result } from "antd";
import { Component, type ReactNode } from "react";

interface ErrorBoundaryState {
  hasError: boolean;
}

// React has no hook for this. A render error or a chunk that failed to load would otherwise leave a blank page.
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <Result
        status="error"
        title="Не вдалося показати сторінку"
        subTitle="Оновіть сторінку. Якщо помилка повторюється, напишіть адміністратору."
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            Оновити сторінку
          </Button>
        }
      />
    );
  }
}
