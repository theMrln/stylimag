import { merge } from 'allof-merge'

import ojsSchema from './article-ojs-metadata.schema.json'
import ojsUiSchema from './article-ojs-ui-schema.json'

const ojsSchemaMerged = merge(ojsSchema)

export const ArticleSchemas = [
  {
    name: 'default',
    data: ojsSchemaMerged,
    const: getConstMetadata(ojsSchemaMerged),
    ui: ojsUiSchema,
  },
]

function getConstMetadata(schema) {
  const props = schema.properties
  return Object.entries(props)
    .filter(([, value]) => value.const !== undefined)
    .reduce(function (map, [key, val]) {
      map[key] = val.const
      return map
    }, {})
}

export function clean(obj) {
  const clone = structuredClone(obj)
  removeEmptyArray(clone)
  removeEmptyObject(clone)
  return clone
}

export function removeEmptyArray(obj) {
  Object.keys(obj).forEach((key) => {
    const prop = obj[key]
    if (Array.isArray(prop) && prop.length === 0) delete obj[key]
    if (typeof prop === 'object' && prop !== null) {
      removeEmptyArray(prop)
    }
  })
}

export function removeEmptyObject(obj) {
  Object.keys(obj).forEach((key) => {
    const prop = obj[key]
    if (typeof prop === 'object' && prop !== null) {
      if (Object.keys(prop).length === 0) {
        delete obj[key]
      } else {
        removeEmptyObject(prop)
      }
    }
  })
}
