package utils

import (
	"regexp"
	"strings"
)

// ExtractJSON extracts a JSON string from a potentially Markdown-wrapped response.
// It handles ```json ... ``` and ``` ... ``` blocks, as well as finding the first { and last }.
func ExtractJSON(content string) string {
	content = strings.TrimSpace(content)

	// If it starts with {, assume it's pure JSON
	if strings.HasPrefix(content, "{") {
		// Verify it also ends with }
		if strings.HasSuffix(content, "}") {
			return content
		}
	}

	// Try to extract from markdown code block (```json ... ```)
	jsonBlockRegex := regexp.MustCompile("(?s)```(?:json)?\\s*([\\s\\S]*?)```")
	if matches := jsonBlockRegex.FindStringSubmatch(content); len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	// Try to find the first '{' and the last '}'
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start != -1 && end != -1 && end > start {
		// Attempt simple balance check for the outermost object
		candidate := content[start : end+1]
		return candidate
	}

	return content
}
