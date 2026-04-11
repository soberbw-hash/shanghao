import type { ErrorInfo, PropsWithChildren, ReactNode } from "react";
import { Component } from "react";

import { Button } from "../base/Button";
import { PageContainer } from "./PageContainer";
import { writeRendererLog } from "../../utils/logger";

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<
  PropsWithChildren,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    void writeRendererLog("app", "error", "Renderer crashed while rendering", {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <PageContainer className="items-center justify-center">
        <div className="w-full max-w-[520px] rounded-[24px] border border-[#E7ECF2] bg-white p-8 shadow-[0_20px_60px_rgba(17,24,39,0.08)]">
          <div className="text-[24px] font-semibold text-[#111827]">页面刚刚出了点问题</div>
          <div className="mt-3 text-sm leading-6 text-[#667085]">
            我已经把错误写进日志了。先刷新一次，如果还是复现，我们就能直接沿着日志继续查。
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={this.handleReload}>重新加载</Button>
          </div>
        </div>
      </PageContainer>
    );
  }
}
