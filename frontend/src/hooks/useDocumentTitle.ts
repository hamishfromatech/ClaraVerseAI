import { useEffect } from 'react';

/**
 * Custom hook to update the document title
 * @param title - The title to set (will be appended to "KaylahGPT | ")
 * @param baseTitle - Optional base title (defaults to "KaylahGPT")
 */
export function useDocumentTitle(title?: string, baseTitle = 'KaylahGPT') {
  useEffect(() => {
    const previousTitle = document.title;

    if (title) {
      document.title = `${baseTitle} | ${title}`;
    } else {
      document.title = baseTitle;
    }

    // Cleanup function to restore previous title
    return () => {
      document.title = previousTitle;
    };
  }, [title, baseTitle]);
}
