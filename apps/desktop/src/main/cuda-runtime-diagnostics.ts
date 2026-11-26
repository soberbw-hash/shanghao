export interface PythonCudaDiagnostics {
  pythonPath: string;
  torchLocation?: string;
  torchVersion?: string;
  torchCudaVersion?: string;
  cudaAvailable: boolean;
  deviceCount: number;
  gpuNames: string[];
  computeCapabilities: string[];
  bf16Supported: boolean;
  fp16Supported: boolean;
  totalVramBytes?: number;
  torchDlls: string[];
  dllLoadFailures: string[];
  nvidiaSmiAvailable: boolean;
  nvidiaDriverVersion?: string;
  nvidiaSmiError?: string;
  cudaInitializationError?: string;
  error?: string;
  failureReason?: CudaRuntimeFailureReason;
}

export type CudaRuntimeFailureReason =
  | "python_missing"
  | "python_start_failed"
  | "torch_missing"
  | "torch_import_failed"
  | "cpu_only_pytorch"
  | "cuda_dll_load_failed"
  | "nvidia_driver_error"
  | "gpu_not_detected"
  | "cuda_runtime_missing"
  | "bf16_unsupported";

export const classifyCudaRuntimeFailure = (
  diagnostics: PythonCudaDiagnostics,
): CudaRuntimeFailureReason | undefined => {
  const error =
    `${diagnostics.error ?? ""}\n${diagnostics.cudaInitializationError ?? ""}`.toLowerCase();
  if (error.includes("ai_runtime_spawn_failed") || error.includes("spawn eperm")) {
    return "python_start_failed";
  }
  if (error.includes("no module named") && error.includes("torch")) return "torch_missing";
  if (diagnostics.error) {
    if (
      error.includes("dll") ||
      error.includes("winerror 126") ||
      error.includes("cannot load") ||
      error.includes("failed to load")
    ) {
      return "cuda_dll_load_failed";
    }
    return "torch_import_failed";
  }
  if (!diagnostics.torchCudaVersion || diagnostics.torchVersion?.toLowerCase().includes("+cpu")) {
    return "cpu_only_pytorch";
  }
  if (diagnostics.dllLoadFailures.length > 0) return "cuda_dll_load_failed";
  if (diagnostics.cudaAvailable && diagnostics.deviceCount > 0) {
    return diagnostics.bf16Supported ? undefined : "bf16_unsupported";
  }
  if (!diagnostics.nvidiaSmiAvailable || error.includes("driver") || error.includes("nvidia")) {
    return "nvidia_driver_error";
  }
  if (diagnostics.deviceCount < 1) return "gpu_not_detected";
  return "cuda_runtime_missing";
};

export const describeCudaRuntimeFailure = (
  reason: CudaRuntimeFailureReason | undefined,
  requiresBf16 = false,
): string | undefined => {
  if (requiresBf16 && reason === "bf16_unsupported")
    return "当前 NVIDIA GPU 不支持 BF16，无法运行所选完整精度模型。";
  switch (reason) {
    case "python_missing":
      return "上号独立 AI Runtime 的 Python 尚未安装。";
    case "python_start_failed":
      return "上号独立 AI Runtime 的 Python 启动失败，请查看诊断日志。";
    case "torch_missing":
      return "上号独立 AI Runtime 缺少 PyTorch，正在尝试修复。";
    case "torch_import_failed":
      return "上号独立 AI Runtime 无法加载 PyTorch，请查看诊断日志。";
    case "cpu_only_pytorch":
      return "上号独立 AI Runtime 误装了 CPU 版 PyTorch，正在尝试修复。";
    case "cuda_dll_load_failed":
      return "上号独立 AI Runtime 的 CUDA DLL 加载失败，请查看诊断日志。";
    case "nvidia_driver_error":
      return "NVIDIA 驱动异常或不可用，请检查显卡驱动。";
    case "gpu_not_detected":
      return "上号独立 AI Runtime 没有识别到 NVIDIA GPU。";
    case "cuda_runtime_missing":
      return "上号独立 AI Runtime 的 CUDA 组件不可用，请尝试修复组件。";
    case "bf16_unsupported":
      return requiresBf16 ? "当前 NVIDIA GPU 不支持 BF16，无法运行所选完整精度模型。" : undefined;
    default:
      return undefined;
  }
};
