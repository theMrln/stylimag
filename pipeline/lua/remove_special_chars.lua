-- This filter removes the Unicode character EF B8 8E from all text elements

local special_char = "\239\184\142"

function Str(element)
    element.text = element.text:gsub(special_char, "")
    return element
end

function Code(element)
    element.text = element.text:gsub(special_char, "")
    return element
end

function CodeBlock(element)
    element.text = element.text:gsub(special_char, "")
    return element
end

function RawBlock(element)
    element.text = element.text:gsub(special_char, "")
    return element
end

function RawInline(element)
    element.text = element.text:gsub(special_char, "")
    return element
end