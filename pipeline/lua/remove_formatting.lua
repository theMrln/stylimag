-- remove_formatting.lua
-- A Pandoc Lua filter to remove highlighting and underlines from text
-- Usage: pandoc input.docx -f docx -t markdown --lua-filter=remove_formatting.lua -o output.md

-- Function to remove specific formatting from spans (highlighting, underlines)
function Span(el)
    -- Check if this span has formatting classes we want to remove
    if el.classes then
      -- Remove highlighting (yellow background)
      if el.classes[1] == "mark" then
        return el.content
      end

      -- Remove underlines
      if el.classes[1] == "underline" then
        return el.content
      end
    end

    return el
  end

  -- Process Link elements to remove underline formatting
  function Link(el)
    -- Remove any attributes related to underline styling
    if el.attributes then
      -- Remove specific underline-related attributes if they exist
      el.attributes["underline"] = nil
      el.attributes["text-decoration"] = nil
    end

    return el
  end

  -- Process RawInline elements that might contain HTML with formatting
  function RawInline(el)
    if el.format == "html" then
      -- Remove highlighting and underline styles from HTML
      -- Replace spans with mark or underline classes with just their content
      el.text = el.text:gsub('<span class="mark">(.-)</span>', '%1')
      el.text = el.text:gsub('<span class="underline">(.-)</span>', '%1')

      -- Remove style attributes that contain text-decoration: underline
      el.text = el.text:gsub('style="[^"]*text%-decoration:%s*underline[^"]*"', '')
    end
    return el
  end

  -- Return the list of functions to apply
  return {
    Span = Span,
    Link = Link,
    RawInline = RawInline
  }