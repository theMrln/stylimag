local function handler (elem)
  -- Get the length of the content
  len = #elem.content
  -- Check that the content isn't empty
  if 0 < len then
    -- Is the last child a space?
    if 'Space' == elem.content[len].tag then
      -- Remove the space (last child)
      elem.content:remove()
      -- Return a space *after* the element
      return { elem, pandoc.Space() }
    end
  end
  return nil
end

return {
  {
    Emph      = handler,
    Strong    = handler,
    Strikeout = handler,
    SmallCaps = handler,
    Underline = handler,
    Span      = handler,
    Link      = handler,
  }
}