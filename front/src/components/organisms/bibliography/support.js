import * as vscode from 'monaco-editor'

import { applicationConfig } from '../../../config.js'

/**
 * Check if a file is a markdown file based on extension
 * @param {File} file
 * @returns {boolean}
 */
function isMarkdownFile(file) {
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')
}

/**
 * Check if a file is an image file based on type
 * @param {File} file
 * @returns {boolean}
 */
function isImageFile(file) {
  return file.type.startsWith('image/')
}

/**
 * Import markdown content into the editor
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 * @param {string} content
 * @param {'replace' | 'insert'} mode
 */
export function importMarkdownContent(editor, content, mode) {
  if (mode === 'replace') {
    const model = editor.getModel()
    const fullRange = model.getFullModelRange()
    editor.executeEdits('import-markdown', [
      {
        range: fullRange,
        text: content,
        forceMoveMarkers: true,
      },
    ])
    editor.setPosition({ lineNumber: 1, column: 1 })
  } else {
    // Insert at cursor position
    editor.trigger('keyboard', 'type', { text: content })
  }
}

/**
 * Read a file as text
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function readFileAsText(file) {
  return file.text()
}

export class BibliographyCompletionProvider {
  constructor(bibTeXEntries) {
    this.monaco = undefined
    this._bibTeXEntries = bibTeXEntries
  }

  get bibTeXEntries() {
    return this._bibTeXEntries
  }

  set bibTeXEntries(value) {
    this._bibTeXEntries = value
  }

  register(monaco) {
    const self = this
    return monaco.languages.registerCompletionItemProvider('markdown', {
      triggerCharacters: '@',
      provideCompletionItems: function (model, position) {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: 1,
          endColumn: position.column,
        })
        const match = textUntilPosition.match(
          /(?:^|\W)(?<square_bracket>\[?)@[^{},~#%\s\\]*$/
        )
        if (!match) {
          return { suggestions: [] }
        }
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }
        const endCharacter = model.getValueInRange({
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column,
          endColumn: position.column + 1,
        })
        const startsWithSquareBracket = match.groups.square_bracket === '['
        return {
          suggestions: self.createBibliographyProposals(
            range,
            { startsWithSquareBracket, endCharacter },
            monaco
          ),
        }
      },
    })
  }

  createBibliographyProposals(range, ctx, monaco) {
    const { startsWithSquareBracket, endCharacter } = ctx
    return this._bibTeXEntries.map((entry) => ({
      label: entry.key,
      kind: monaco.languages.CompletionItemKind.Reference,
      documentation: entry.title,
      insertText:
        startsWithSquareBracket && endCharacter !== ']'
          ? `${entry.key}] `
          : `${entry.key} `,
      range: range,
    }))
  }
}

/**
 * Creates a drop handler for the Monaco editor
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 * @param {object} options
 * @param {(file: File) => void} options.onMarkdownFile - Callback when a markdown file is dropped
 * @returns {function}
 */
export function onDropIntoEditor(editor, options = {}) {
  const { onMarkdownFile } = options
  
  return async ({ position, event }) => {
    event.preventDefault()
    
    try {
      const files = event.dataTransfer.files
      
      // Check for markdown files first
      for (const file of files) {
        if (isMarkdownFile(file)) {
          if (onMarkdownFile) {
            onMarkdownFile(file)
          } else {
            // Fallback: insert content at cursor if no callback provided
            const content = await readFileAsText(file)
            importMarkdownContent(editor, content, 'insert')
          }
          return // Only handle first markdown file
        }
      }
      
      // Handle image files (existing behavior)
      if (window.location.hostname === 'localhost') {
        console.debug(
          'imgur.com disallows API call from localhost, cannot upload images'
        )
      }
      if (
        applicationConfig.imgurClientId === undefined ||
        applicationConfig.imgurClientId.trim() === ''
      ) {
        console.warn(
          `IMGUR_CLIENT_ID is empty or undefined, cannot upload images`
        )
      }
      
      const lineNumber = position.lineNumber
      let column = position.column
      for (const file of files) {
        if (!isImageFile(file)) continue
        
        const placeholder = `<!-- Uploading ${file.name} -->`
        editor.executeEdits('insert-uploading-placeholder', [
          {
            range: new vscode.Range(lineNumber, column, lineNumber, column),
            text: `${placeholder} `,
            forceMoveMarkers: true,
          },
        ])
        column = column + placeholder.length + 1
        editor.setPosition({
          lineNumber: lineNumber,
          column,
        })
      }
      for (const file of files) {
        if (!isImageFile(file)) continue
        
        // sequential upload
        const formData = new FormData()
        formData.append('image', file)
        formData.append('title', file.name)
        const response = await fetch('https://api.imgur.com/3/image', {
          method: 'POST',
          headers: {
            Authorization: `Client-ID ${applicationConfig.imgurClientId}`,
          },
          body: formData,
        })
        if (response.ok) {
          const result = await response.json()
          const placeholder = `<!-- Uploading ${file.name} -->`
          const matches = editor.getModel().findMatches(placeholder)
          if (matches && matches.length > 0) {
            const match = matches[0]
            editor.executeEdits('replace-uploading-placeholder', [
              {
                range: match.range,
                text: `![](${result.data.link})`,
                forceMoveMarkers: true,
              },
            ])
          }
        } else {
          let responseBody = ''
          try {
            responseBody = JSON.stringify(await response.json())
          } catch {
            // ignore
            console.warn('Unable to parse response body as JSON')
          }
          console.error(
            `Error while uploading file: ${file.name} - {status: ${response.status}, body: ${responseBody}}`
          )
        }
      }
    } catch (error) {
      console.error(
        'Something went wrong while dropping a file into the text editor',
        error
      )
    }
  }
}
