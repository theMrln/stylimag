import clsx from 'clsx'
import { GripVertical, Plus, Trash } from 'lucide-react'
import { set } from 'object-path-immutable'
import PropTypes from 'prop-types'
import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import { useDrag, useDrop } from 'react-dnd'
import { Translation } from 'react-i18next'

import Form, { getDefaultRegistry } from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'

import { Button } from '../atoms/index.js'

import isidoreAuthorSearch from '../organisms/metadata/isidoreAuthor.jsx'
import IsidoreAuthorAPIAutocompleteField from '../organisms/metadata/isidoreAuthor.jsx'
import isidoreKeywordSearch from '../organisms/metadata/isidoreKeyword.jsx'
// remove once fixed in https://github.com/rjsf-team/react-jsonschema-form/issues/1041
import SelectWidget from './SelectWidget.jsx'
import ToggleWidget from './ToggleWidget.jsx'

// REMIND: use a custom SelectWidget to support "ui:emptyValue"
import styles from './form.module.scss'

const {
  templates: { BaseInputTemplate: DefaultBaseInputTemplate },
  widgets: { CheckboxesWidget },
} = getDefaultRegistry()

/**
 * @param {BaseInputTemplate} properties
 * @returns {Element}
 */
function BaseInputTemplate(properties) {
  const { placeholder } = properties
  return (
    <Translation ns="form" useSuspense={false}>
      {(t) => (
        <DefaultBaseInputTemplate
          {...properties}
          placeholder={t(placeholder)}
        />
      )}
    </Translation>
  )
}

/**
 * @param {SelectWidget} properties
 * @returns {Element}
 */
function CustomSelectWidget(properties) {
  const { options, title, placeholder } = properties
  return (
    <div
      className={clsx(
        styles.selectContainer,
        (properties.disabled || properties.readonly) && styles.selectDisabled
      )}
    >
      <Translation ns="form" useSuspense={false}>
        {(t) => (
          <SelectWidget
            {...{
              ...properties,
              placeholder: t(placeholder),
              options: {
                enumOptions: options?.enumOptions?.map((opt) => {
                  if (title && opt.label in title) {
                    return {
                      label: t(title[opt.label]),
                      value: opt.value,
                    }
                  }
                  return {
                    label: t(opt.label),
                    value: opt.value,
                  }
                }),
              },
            }}
          />
        )}
      </Translation>
    </div>
  )
}

/**
 * @param {WidgetProps} properties
 * @returns {Element}
 */
function CustomCheckboxesWidget(properties) {
  const { options, title } = properties
  return (
    <Translation ns="form" useSuspense={false}>
      {(t) => (
        <CheckboxesWidget
          {...{
            ...properties,
            options: {
              enumOptions: options?.enumOptions?.map((opt) => {
                if (title && opt.label in title) {
                  return {
                    label: t(title[opt.label]),
                    value: opt.value,
                  }
                }
                return {
                  label: t(opt.label),
                  value: opt.value,
                }
              }),
            },
          }}
        />
      )}
    </Translation>
  )
}

/**
 * Render an array item with a drag handle. Hover-driven reorder calls into
 * RJSF's own onReorderClick so the form data (and any onChange consumer such
 * as the metadata-save flow) stays in sync. We keep the live `properties.items`
 * reference in a ref so `moveItem` is stable across renders.
 *
 * @param {object} props
 * @returns {Element}
 */
function DraggableArrayItem({
  index,
  type,
  moveItem,
  className,
  children,
  removeButton,
  disabled,
}) {
  const ref = useRef(null)
  const handleRef = useRef(null)

  const [{ handlerId }, drop] = useDrop({
    accept: type,
    collect(monitor) {
      return { handlerId: monitor.getHandlerId() }
    },
    hover(item) {
      if (!ref.current) return
      const dragIndex = item.index
      const hoverIndex = index
      if (dragIndex === hoverIndex) return
      moveItem(dragIndex, hoverIndex)
      // mutate the dragged item so subsequent hovers compare against the new index
      item.index = hoverIndex
    },
  })

  const [{ isDragging }, drag, preview] = useDrag({
    type,
    item: () => ({ index }),
    canDrag: () => !disabled,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  })

  preview(drop(ref))
  drag(handleRef)

  return (
    <div
      ref={ref}
      data-handler-id={handlerId}
      className={clsx(className, styles.draggableArrayItem)}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <span
        ref={handleRef}
        className={styles.dragHandle}
        aria-label="Drag to reorder"
        title="Drag to reorder"
      >
        <GripVertical size={16} />
      </span>
      <div className={styles.draggableArrayItemBody}>
        {children}
        {removeButton}
      </div>
    </div>
  )
}

/**
 * @param {ArrayFieldTemplateProps} properties
 * @returns {Element}
 */
function ArrayFieldTemplate(properties) {
  const addItemTitle =
    properties.uiSchema['ui:add-item-title'] ?? 'form.itemAdd'
  const removeItemTitle =
    properties.uiSchema['ui:remove-item-title'] ?? 'form.itemRemove'
  const title = properties.uiSchema['ui:title']
  const draggable = properties.uiSchema['ui:options']?.draggable === true
  const inlineRemoveButton =
    properties.schema?.items?.type === 'string' || !removeItemTitle
  // For draggable arrays, preserve natural order so the displayed sequence
  // matches what gets written back to OJS as `seq: i`. For everything else
  // keep the existing newest-first display.
  const items = draggable
    ? properties.items
    : [...properties.items].reverse()

  // Keep a ref to the live items so the moveItem callback stays stable.
  const itemsRef = useRef(properties.items)
  itemsRef.current = properties.items
  const moveItem = useCallback((dragIndex, hoverIndex) => {
    const fn = itemsRef.current[dragIndex]?.onReorderClick(
      dragIndex,
      hoverIndex
    )
    if (typeof fn === 'function') fn()
  }, [])

  // Per-array drag type so concurrent draggable arrays do not steal each other's items.
  const dragType = `rjsf-array-${properties.idSchema?.$id || properties.id || 'default'}`

  const renderRemoveButton = (element) =>
    element.hasRemove ? (
      <Button
        icon={inlineRemoveButton}
        type="button"
        className={[
          styles.removeButton,
          inlineRemoveButton ? styles.inlineRemoveButton : '',
        ].join(' ')}
        tabIndex={-1}
        disabled={element.disabled || element.readonly}
        onClick={element.onDropIndexClick(element.index)}
      >
        <Trash />
        {inlineRemoveButton ? (
          ''
        ) : (
          <Translation ns="form" useSuspense={false}>
            {(t) => t(removeItemTitle)}
          </Translation>
        )}
      </Button>
    ) : null

  return (
    <fieldset
      className={clsx(styles.fieldset, styles.array)}
      key={properties.key}
    >
      {title && (
        <Translation ns="form" useSuspense={false}>
          {(t) => <legend id={properties.id}>{t(title)}</legend>}
        </Translation>
      )}
      {properties.canAdd && (
        <Button
          disabled={properties.disabled || properties.readonly}
          type="button"
          className={styles.addButton}
          tabIndex={-1}
          onClick={properties.onAddClick}
        >
          <Plus />
          <Translation ns="form" useSuspense={false}>
            {(t) => t(addItemTitle)}
          </Translation>
        </Button>
      )}
      {items &&
        items.map((element) => {
          const wrapperClassName = clsx(
            element.className,
            'can-add-remove',
            element?.uiSchema?.['ui:className']
          )
          if (draggable) {
            return (
              <DraggableArrayItem
                key={element.key}
                index={element.index}
                type={dragType}
                moveItem={moveItem}
                className={wrapperClassName}
                disabled={element.disabled || element.readonly}
                removeButton={renderRemoveButton(element)}
              >
                {element.children}
              </DraggableArrayItem>
            )
          }
          return (
            <div
              id={element.key}
              key={element.key}
              className={wrapperClassName}
            >
              {element.children}
              {renderRemoveButton(element)}
            </div>
          )
        })}
    </fieldset>
  )
}

function FieldTemplate(properties) {
  const {
    id,
    classNames,
    style,
    help,
    description,
    errors,
    children,
    displayLabel,
  } = properties
  const label = properties.schema.$id
    ? properties.label[properties.schema.$id]
    : properties.label

  if (properties.hidden) {
    return <></>
  }
  return (
    <div className={classNames} style={style}>
      {displayLabel && (
        <label htmlFor={id}>
          <Translation ns="form" useSuspense={false}>
            {(t) => <>{t(label)}</>}
          </Translation>
        </label>
      )}
      {description}
      {children}
      {errors}
      {help}
    </div>
  )
}

/**
 * @param {ObjectFieldTemplateProps} properties
 * @returns {JSX.Element|undefined}
 */
function ObjectFieldTemplate(properties) {
  if (properties.uiSchema['ui:groups']) {
    const groups = properties.uiSchema['ui:groups']
    const groupedElements = groups.map(({ fields, title }) => {
      const elements = fields
        .filter(
          (field) =>
            (properties.uiSchema[field] || {})['ui:widget'] !== 'hidden'
        )
        .map((field) => {
          const element = properties.properties.find(
            (element) => element.name === field
          )

          if (!element) {
            console.error(
              'Field configuration not found for "%s" in \'ui:groups\' "%s" — part of %o',
              field,
              title || '',
              fields
            )
          }

          return [field, element]
        })

      if (elements && elements.length > 0) {
        return (
          <fieldset className={styles.fieldset} key={fields.join('-')}>
            {title && (
              <legend>
                <Translation ns="form" useSuspense={false}>
                  {(t) => <>{t(title)}</>}
                </Translation>
              </legend>
            )}
            {elements.map(([field, element]) => {
              return element ? (
                <Fragment key={field}>{element.content}</Fragment>
              ) : (
                <p key={field} className={styles.fieldHasNoElementError}>
                  Field <code>{field}</code> defined in <code>ui:groups</code>{' '}
                  is not an entry of <code>data-schema.json[properties]</code>{' '}
                  object.
                </p>
              )
            })}
          </fieldset>
        )
      }
    })

    return <>{groupedElements}</>
  }

  if (properties) {
    const autocomplete = properties.uiSchema['ui:autocomplete']
    return (
      <Fragment key={properties.key}>
        {properties.description}
        {autocomplete === 'IsidoreAuthorSearch' && (
          <IsidoreAuthorAPIAutocompleteField {...properties} />
        )}
        {properties.properties.map((element) => (
          <Fragment key={element.name}>{element.content}</Fragment>
        ))}
      </Fragment>
    )
  }
}

const customFields = {
  IsidoreKeywordSearch: isidoreKeywordSearch,
  IsidoreAuthorSearch: isidoreAuthorSearch,
}

/**
 * @param {object} props properties
 * @param {Record<string, unknown>} props.formData
 * @param {boolean} props.readOnly
 * @param {Record<string, unknown>} props.schema
 * @param {Record<string, unknown>} props.uiSchema
 * @param {(formData: Record<string, unknown>) => void} props.onChange
 * @returns {Element}
 */
export default function SchemaForm({
  formData: initialFormData,
  readOnly,
  schema,
  uiSchema,
  onChange = () => {},
}) {
  const [formData, setFormData] = useState(initialFormData)
  const [, setErrors] = useState({})
  const formContext = useMemo(
    () => ({
      partialUpdate: ({ id, value }) => {
        const path = id.replace('root_', '').replace('_', '.')
        setFormData((state) => {
          const newFormData = set(state, path, value)
          onChange(newFormData)
          return newFormData
        })
      },
    }),
    [onChange, setFormData]
  )

  const customWidgets = {
    SelectWidget: CustomSelectWidget,
    CheckboxesWidget: CustomCheckboxesWidget,
    toggle: ToggleWidget,
  }

  const customTemplates = {
    ObjectFieldTemplate,
    FieldTemplate,
    BaseInputTemplate,
    ArrayFieldTemplate,
  }

  const handleUpdate = useCallback(
    (event) => {
      const formData = event.formData
      setFormData(formData)
      onChange(formData)
    },
    [setFormData, onChange]
  )

  // noinspection JSValidateTypes
  return (
    <Form
      readonly={readOnly}
      className={styles.form}
      formContext={formContext}
      schema={schema}
      name="Metadata"
      templates={customTemplates}
      widgets={customWidgets}
      fields={customFields}
      uiSchema={uiSchema}
      formData={formData}
      onChange={handleUpdate}
      onError={setErrors}
      validator={validator}
    >
      <hr hidden={true} />
    </Form>
  )
}

SchemaForm.propTypes = {
  formData: PropTypes.object,
  schema: PropTypes.object,
  uiSchema: PropTypes.object,
  basicMode: PropTypes.bool,
  onChange: PropTypes.func,
}
