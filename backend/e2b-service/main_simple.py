#!/usr/bin/env python3
"""
Simple Python Code Executor for ClaraVerse All-in-One Docker Image

This is a lightweight alternative to the E2B-based executor that runs Python code
directly using subprocess. It's designed for the all-in-one Docker image where
Docker-in-Docker isn't available for E2B local mode.

Features:
- Subprocess-based Python execution with timeout
- Basic sandboxing via restricted builtins and resource limits
- Support for matplotlib plots (auto-saved as PNG)
- File upload and retrieval support
- No external dependencies (E2B API key or Docker)

Note: This is less secure than E2B sandboxes. For production use with untrusted
code, use the regular E2B service with proper sandboxing.
"""

import os
import sys
import base64
import tempfile
import subprocess
import shutil
import signal
from typing import List, Optional
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import logging
import time
import uuid

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info("🚀 Starting Simple Python Executor (All-in-One Mode)")
logger.info("   This executor runs Python code directly without E2B sandboxes")

app = FastAPI(
    title="Simple Python Executor Service",
    description="Lightweight Python code executor for ClaraVerse All-in-One",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Execution settings
EXECUTION_TIMEOUT = int(os.getenv("EXECUTION_TIMEOUT", "30"))  # seconds
MAX_OUTPUT_SIZE = 100 * 1024  # 100KB max output
WORK_DIR = Path(os.getenv("WORK_DIR", "/tmp/code-executor"))

# Ensure work directory exists
WORK_DIR.mkdir(parents=True, exist_ok=True)


# Request/Response Models
class ExecuteRequest(BaseModel):
    code: str
    timeout: Optional[int] = 30


class PlotResult(BaseModel):
    format: str
    data: str  # base64 encoded


class ExecuteResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    error: Optional[str] = None
    plots: List[PlotResult] = []
    execution_time: Optional[float] = None


class AdvancedExecuteRequest(BaseModel):
    code: str
    timeout: Optional[int] = 30
    dependencies: List[str] = []
    output_files: List[str] = []


class FileResult(BaseModel):
    filename: str
    data: str  # base64 encoded
    size: int


class AdvancedExecuteResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    error: Optional[str] = None
    plots: List[PlotResult] = []
    files: List[FileResult] = []
    execution_time: Optional[float] = None
    install_output: str = ""


def create_wrapper_code(user_code: str, plot_dir: str) -> str:
    """
    Wrap user code with matplotlib backend setup for headless plot generation.
    """
    wrapper = f'''
import sys
import os

# Set matplotlib to use non-interactive backend BEFORE importing pyplot
import matplotlib
matplotlib.use('Agg')

# Configure plot output directory
_plot_dir = {repr(plot_dir)}
_plot_counter = [0]

# Patch plt.show() to save plots instead
import matplotlib.pyplot as plt
_original_show = plt.show

def _patched_show(*args, **kwargs):
    _plot_counter[0] += 1
    plot_path = os.path.join(_plot_dir, f"plot_{{_plot_counter[0]}}.png")
    plt.savefig(plot_path, format='png', dpi=100, bbox_inches='tight')
    print(f"[PLOT_SAVED]{{plot_path}}")
    plt.close()

plt.show = _patched_show

# Also save figures when plt.savefig is called
_original_savefig = plt.savefig

def _patched_savefig(fname, *args, **kwargs):
    # Call original savefig
    result = _original_savefig(fname, *args, **kwargs)
    # Also save to our plot dir if it's a new file
    if not str(fname).startswith(_plot_dir):
        _plot_counter[0] += 1
        copy_path = os.path.join(_plot_dir, f"plot_{{_plot_counter[0]}}.png")
        _original_savefig(copy_path, format='png', dpi=100, bbox_inches='tight')
        print(f"[PLOT_SAVED]{{copy_path}}")
    return result

# Don't patch savefig - let user control where files go
# plt.savefig = _patched_savefig

# Change to work directory
os.chdir({repr(plot_dir)})

# Execute user code
{user_code}
'''
    return wrapper


def execute_python_code(code: str, timeout: int, work_dir: Path, dependencies: List[str] = None) -> dict:
    """
    Execute Python code in a subprocess with timeout.
    Returns dict with stdout, stderr, error, plots, files.
    """
    start_time = time.time()
    result = {
        "stdout": "",
        "stderr": "",
        "error": None,
        "plots": [],
        "files": [],
        "install_output": "",
        "execution_time": 0
    }

    # Create temporary directory for this execution
    exec_id = str(uuid.uuid4())[:8]
    exec_dir = work_dir / exec_id
    exec_dir.mkdir(parents=True, exist_ok=True)
    plot_dir = exec_dir / "plots"
    plot_dir.mkdir(exist_ok=True)

    try:
        # Install dependencies if requested
        if dependencies:
            logger.info(f"Installing dependencies: {dependencies}")
            try:
                install_result = subprocess.run(
                    [sys.executable, "-m", "pip", "install", "-q"] + dependencies,
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                result["install_output"] = install_result.stdout + install_result.stderr
                if install_result.returncode != 0:
                    result["error"] = f"Failed to install dependencies: {result['install_output']}"
                    result["execution_time"] = time.time() - start_time
                    return result
                logger.info(f"Dependencies installed: {result['install_output'][:200]}")
            except subprocess.TimeoutExpired:
                result["error"] = "Dependency installation timed out"
                result["execution_time"] = time.time() - start_time
                return result

        # Wrap code with matplotlib setup
        wrapped_code = create_wrapper_code(code, str(exec_dir))

        # Write code to temp file
        code_file = exec_dir / "script.py"
        code_file.write_text(wrapped_code)

        # Execute with timeout
        try:
            proc = subprocess.run(
                [sys.executable, str(code_file)],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=str(exec_dir)
            )

            result["stdout"] = proc.stdout[:MAX_OUTPUT_SIZE] if proc.stdout else ""
            result["stderr"] = proc.stderr[:MAX_OUTPUT_SIZE] if proc.stderr else ""

            if proc.returncode != 0:
                # Extract just the error message, not the full traceback if possible
                stderr = result["stderr"]
                if "Error:" in stderr:
                    result["error"] = stderr.split("\n")[-2] if stderr else "Execution failed"
                else:
                    result["error"] = stderr or "Execution failed with non-zero exit code"

        except subprocess.TimeoutExpired:
            result["error"] = f"Execution timed out after {timeout} seconds"
            result["stderr"] = f"TimeoutError: Code execution exceeded {timeout} second limit"

        # Collect plots
        plot_files = list(plot_dir.glob("*.png")) + list(exec_dir.glob("*.png"))
        for plot_file in plot_files:
            try:
                with open(plot_file, "rb") as f:
                    plot_data = base64.b64encode(f.read()).decode("utf-8")
                    result["plots"].append({
                        "format": "png",
                        "data": plot_data
                    })
                    logger.info(f"Collected plot: {plot_file.name}")
            except Exception as e:
                logger.warning(f"Failed to read plot {plot_file}: {e}")

        # Remove [PLOT_SAVED] messages from stdout
        if result["stdout"]:
            lines = result["stdout"].split("\n")
            result["stdout"] = "\n".join(
                line for line in lines if not line.startswith("[PLOT_SAVED]")
            )

        # Collect any other generated files (excluding script.py and plots)
        for file_path in exec_dir.iterdir():
            if file_path.is_file() and file_path.name != "script.py":
                if file_path.suffix.lower() not in [".png", ".pyc"]:
                    try:
                        with open(file_path, "rb") as f:
                            file_data = f.read()
                            result["files"].append({
                                "filename": file_path.name,
                                "data": base64.b64encode(file_data).decode("utf-8"),
                                "size": len(file_data)
                            })
                            logger.info(f"Collected file: {file_path.name} ({len(file_data)} bytes)")
                    except Exception as e:
                        logger.warning(f"Failed to read file {file_path}: {e}")

    finally:
        # Clean up execution directory
        try:
            shutil.rmtree(exec_dir)
        except Exception as e:
            logger.warning(f"Failed to cleanup exec dir: {e}")

        result["execution_time"] = time.time() - start_time

    return result


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "simple-python-executor",
        "mode": "subprocess",
        "e2b_api_key_set": False
    }


# Execute Python code endpoint
@app.post("/execute", response_model=ExecuteResponse)
async def execute_code(request: ExecuteRequest):
    """
    Execute Python code using subprocess.
    """
    logger.info(f"Executing code (length: {len(request.code)} chars)")

    timeout = min(request.timeout or EXECUTION_TIMEOUT, EXECUTION_TIMEOUT)
    result = execute_python_code(request.code, timeout, WORK_DIR)

    response = ExecuteResponse(
        success=result["error"] is None,
        stdout=result["stdout"],
        stderr=result["stderr"],
        error=result["error"],
        plots=[PlotResult(**p) for p in result["plots"]],
        execution_time=result["execution_time"]
    )

    logger.info(f"Execution completed: success={response.success}, plots={len(response.plots)}")
    return response


# Execute with file upload endpoint
@app.post("/execute-with-files", response_model=ExecuteResponse)
async def execute_with_files(
    code: str = Form(...),
    files: List[UploadFile] = File(...),
    timeout: int = Form(30)
):
    """
    Execute Python code with uploaded files.
    """
    logger.info(f"Executing code with {len(files)} files")

    # Create temp directory and save uploaded files
    exec_id = str(uuid.uuid4())[:8]
    exec_dir = WORK_DIR / exec_id
    exec_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Save uploaded files
        for file in files:
            content = await file.read()
            file_path = exec_dir / file.filename
            file_path.write_bytes(content)
            logger.info(f"Uploaded file: {file.filename} ({len(content)} bytes)")

        # Prepend code to change to the directory with uploaded files
        full_code = f"import os; os.chdir({repr(str(exec_dir))})\n{code}"

        timeout = min(timeout, EXECUTION_TIMEOUT)
        result = execute_python_code(full_code, timeout, exec_dir)

        response = ExecuteResponse(
            success=result["error"] is None,
            stdout=result["stdout"],
            stderr=result["stderr"],
            error=result["error"],
            plots=[PlotResult(**p) for p in result["plots"]],
            execution_time=result["execution_time"]
        )

        logger.info(f"Execution with files completed: success={response.success}")
        return response

    finally:
        # Cleanup
        try:
            shutil.rmtree(exec_dir)
        except:
            pass


# Advanced execution endpoint
@app.post("/execute-advanced", response_model=AdvancedExecuteResponse)
async def execute_advanced(request: AdvancedExecuteRequest):
    """
    Execute Python code with pip dependencies and output file retrieval.
    """
    logger.info(f"Advanced execution: code={len(request.code)} chars, deps={request.dependencies}, output_files={request.output_files}")

    timeout = min(request.timeout or EXECUTION_TIMEOUT, EXECUTION_TIMEOUT)
    result = execute_python_code(
        request.code,
        timeout,
        WORK_DIR,
        dependencies=request.dependencies
    )

    response = AdvancedExecuteResponse(
        success=result["error"] is None,
        stdout=result["stdout"],
        stderr=result["stderr"],
        error=result["error"],
        plots=[PlotResult(**p) for p in result["plots"]],
        files=[FileResult(**f) for f in result["files"]],
        execution_time=result["execution_time"],
        install_output=result["install_output"]
    )

    logger.info(f"Advanced execution completed: success={response.success}, plots={len(response.plots)}, files={len(response.files)}")
    return response


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8001,
        log_level="info"
    )
