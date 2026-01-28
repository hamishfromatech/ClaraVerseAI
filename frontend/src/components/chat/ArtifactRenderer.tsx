import { PdfArtifact, HtmlArtifact } from '@/components/artifact';

interface ToolResultData {
  download_url?: string;
  filename?: string;
  file_type?: string;
  size?: number;
  success?: boolean;
}

interface ArtifactRendererProps {
  toolResult: string;
  backendUrl: string;
}

export function ArtifactRenderer({ toolResult, backendUrl }: ArtifactRendererProps) {
  let parsedResult: ToolResultData;

  try {
    parsedResult = JSON.parse(toolResult);
  } catch {
    return null;
  }

  if (!parsedResult || !parsedResult.download_url) {
    return null;
  }

  // Check if URL is already absolute (from backend tools)
  const isAbsoluteUrl =
    parsedResult.download_url.startsWith('http://') ||
    parsedResult.download_url.startsWith('https://');
  const isLocalhostUrl = parsedResult.download_url.includes('localhost');
  let downloadUrl = isAbsoluteUrl
    ? parsedResult.download_url
    : `${backendUrl}${parsedResult.download_url}`;
  if (isLocalhostUrl && !downloadUrl.startsWith(backendUrl)) {
    const url = new URL(parsedResult.download_url);
    downloadUrl = `${backendUrl}${url.pathname}${url.search}`;
  }

  const filename = parsedResult.filename || 'Document';

  // Determine artifact type based on file_type or extension
  const isPdf = parsedResult.file_type === 'pdf' || filename.toLowerCase().endsWith('.pdf');
  const isHtml = parsedResult.file_type === 'html' || filename.toLowerCase().endsWith('.html');

  if (isPdf) {
    return <PdfArtifact url={downloadUrl} title={filename} filename={filename} />;
  }

  if (isHtml) {
    return <HtmlArtifact url={downloadUrl} title={filename} filename={filename} />;
  }

  // Not a displayable artifact type
  return null;
}
