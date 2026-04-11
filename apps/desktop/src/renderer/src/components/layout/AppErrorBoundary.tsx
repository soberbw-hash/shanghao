import type { ErrorInfo, PropsWithChildren, ReactNode } from "react";
import { Component } from "react";

import { Button } from "../base/Button";
import { PageContainer } from "./PageContainer";
import { useAppStore } from "../../store/appStore";
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

    useAppStore.getState().showStartupRecovery({
      title: "页面加载失败",
      description: "上号在渲染界面时出了问题。你可以重试，或者先用安全模式继续进入。",
      details: [error.message],
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
          <div className="text-[24px] font-semibold text-[#111827]">页面刚刚出错了</div>
          <div className="mt-3 text-sm leading-6 text-[#667085]">
            错误已经写进日志。你可以先重新加载，如果还会复现，我们就能顺着日志继续查。
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={this.handleReload}>重新加载</Button>
          </div>
        </div>
      </PageContainer>
    );
  }
}
