import { fileExists } from '@contentlayer/utils'
import { promises as fs } from 'fs'
import * as path from 'path'
import { Config } from '../config'
import { FieldDef, ListFieldDefItem, SchemaDef } from '../schema'
import { makeArtifactsDir } from '../utils'

export const generateTypes = async ({
  config,
  generateSchemaJson,
}: {
  config: Config
  generateSchemaJson?: boolean
}): Promise<void> => {
  const schemaDef = await config.source.provideSchema()

  if (generateSchemaJson) {
    const artifactsDirPath = await makeArtifactsDir()
    await fs.writeFile(path.join(artifactsDirPath, 'schema.json'), JSON.stringify(schemaDef, null, 2))
  }

  const source = buildSource(schemaDef)

  const typegenTargetDir = path.join('node_modules', '@types', 'contentlayer', 'types')
  await fs.mkdir(typegenTargetDir, { recursive: true })

  const typegenTargetFilePath = path.join(typegenTargetDir, 'index.d.ts')
  if (await fileExists(typegenTargetFilePath)) {
    await fs.unlink(typegenTargetFilePath)
  }
  await fs.writeFile(typegenTargetFilePath, source)

  console.log(`Type file successfully written to ${typegenTargetFilePath}`)
}

const buildSource = (schemaDef: SchemaDef): string => {
  const documentTypes = Object.values(schemaDef.documentDefMap)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((docDef) => ({
      typeName: docDef.name,
      fieldDefs:
        docDef.fieldDefs.map(renderFieldDef).join('\n') +
        '\n' +
        docDef.computedFields
          .map(
            (field) =>
              `${field.description ? `    /** ${field.description} */\n` : ''}    ${field.name}: ${field.type}`,
          )
          .join('\n'),
      description: docDef.description ?? docDef.label,
    }))
    .map(({ typeName, fieldDefs, description }) => ({
      typeName,
      typeDef: `\
${description ? `/** ${description} */\n` : ''}export type ${typeName} = {
  _id: string
  _typeName: '${typeName}'
  _raw?: Record<string, any>
${fieldDefs}
}`,
    }))

  // ...(docDef.computedFields ? docDef.computedFields(_ => _) : []),

  const objectTypes = Object.values(schemaDef.objectDefMap)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((objectDef) => ({
      typeName: objectDef.name,
      description: objectDef.description ?? objectDef.label,
      fieldDefs: objectDef.fieldDefs.map(renderFieldDef).join('\n'),
    }))
    .map(({ typeName, description, fieldDefs }) => ({
      typeName,
      typeDef: `\
${description ? `/** ${description} */\n` : ''}export type ${typeName} = {
  _typeName: '${typeName}'
  _raw?: Record<string, any>
${fieldDefs}
}`,
    }))

  const typeMap = documentTypes
    .map((_) => _.typeName)
    .map((_) => `  ${_}: ${_}`)
    .join('\n')

  return `\
// NOTE This file is auto-generated by the Contentlayer CLI
import type { Markdown } from '@contentlayer/core'

export type Image = string
export type { Markdown }



export interface ContentlayerGenTypes {
  documentTypes: DocumentTypes
  documentTypeMap: DocumentTypeMap
  documentTypeNames: DocumentTypeNames
  allTypeNames: AllTypeNames
}

declare global {
  interface ContentlayerGen extends ContentlayerGenTypes {}
}

export type DocumentTypeMap = {
${typeMap}
}

export type AllTypes = DocumentTypes | ObjectTypes
export type AllTypeNames = DocumentTypeNames | ObjectTypeNames

export type DocumentTypes = ${documentTypes.map((_) => _.typeName).join(' | ')}
export type DocumentTypeNames = DocumentTypes['_typeName']

/** Document types */

${/*export namespace Documents {
  export { ${documentTypes.map((_) => _.typeName).join(', ')} }
}*/ ``}

${documentTypes.map((_) => _.typeDef).join('\n\n')}

/** Object types */

${/*export namespace Objects {
  export { ${objectTypes.map((_) => _.typeName).join(', ')} }
}*/ ``}

export type ObjectTypes = ${objectTypes.length > 0 ? objectTypes.map((_) => _.typeName).join(' | ') : 'never'}
export type ObjectTypeNames = ObjectTypes['_typeName']

${objectTypes.map((_) => _.typeDef).join('\n\n')}
`
}

function renderFieldDef(field: FieldDef): string {
  return `${field.description ? `  /** ${field.description} */\n` : ''}  ${field.name}: ${renderFieldType(field)}${
    field.required ? '' : ' | undefined'
  }`
}

function renderFieldType(field: FieldDef): string {
  switch (field.type) {
    case 'boolean':
    case 'string':
      return field.type
    case 'date':
      return 'string'
    // TODO but requires schema knowledge in the client
    // return 'Date'
    case 'image':
      return 'Image'
    case 'markdown':
      return 'Markdown'
    case 'inline_object':
      return '{\n' + field.fieldDefs.map(renderFieldDef).join('\n') + '\n}'
    case 'object': {
      return field.objectName
    }
    case 'reference':
      return 'string'
    case 'polymorphic_list':
      const wrapInParenthesis = (_: string) => `(${_})`
      return wrapInParenthesis(field.of.map(renderListItemFieldType).join(' | ')) + '[]'
    case 'list':
      return renderListItemFieldType(field.of) + '[]'
    case 'enum':
      return field.options.map((_) => `'${_}'`).join(' | ')
    default:
      return `'todo ${field.type}'`
  }
}

function renderListItemFieldType(item: ListFieldDefItem): string {
  switch (item.type) {
    case 'boolean':
    case 'string':
      return item.type
    case 'object':
      return item.objectName
    case 'enum':
      return '(' + item.options.map((_) => `'${_}'`).join(' | ') + ')'
    case 'inline_object':
      return '{\n' + item.fieldDefs.map(renderFieldDef).join('\n') + '\n}'
    case 'reference':
      return item.documentName
  }
}
