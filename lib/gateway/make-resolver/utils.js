'use strict'

const { getNamedType, print, parse, Kind } = require('graphql')

const { MER_ERR_GQL_GATEWAY_MISSING_KEY_DIRECTIVE } = require('../../errors')

const kEntityResolvers = Symbol('mercurius.entity-resolvers')

function getFieldType(schema, type, fieldName) {
  return getNamedType(schema.getType(type).getFields()[fieldName].type)
}

function getInlineFragmentType(schema, type) {
  return getNamedType(schema.getType(type))
}

function getDirectiveSelection(node, directiveName) {
  if (!node || !node.astNode) {
    return []
  }

  const directive = node.astNode.directives.find(
    directive => directive.name.value === directiveName
  )

  if (!directive) {
    return []
  }

  const query = parse(`{ ${directive.arguments[0].value.value} }`)

  return query.definitions[0].selectionSet.selections
}

function getDirectiveRequiresSelection(selections, type) {
  if (
    !type.extensionASTNodes ||
    type.extensionASTNodes.length === 0 ||
    !type.extensionASTNodes[0].fields[0] ||
    !type.extensionASTNodes[0].fields[0].directives[0]
  ) {
    return []
  }

  const requires = []
  const selectedFields = selections.map(selection => selection.name.value)

  for (let i = 0; i < type.extensionASTNodes.length; i++) {
    for (let j = 0; j < type.extensionASTNodes[i].fields.length; j++) {
      const field = type.extensionASTNodes[i].fields[j]
      if (!selectedFields.includes(field.name.value) || !field.directives) {
        continue
      }
      const directive = field.directives.find(d => d.name.value === 'requires')
      if (!directive) {
        continue
      }
      // assumes arguments is always present, might require a custom error in case it is not
      const query = parse(`{ ${directive.arguments[0].value.value} }`)
      requires.push(...query.definitions[0].selectionSet.selections)
    }
  }

  return requires
}

function collectServiceTypeFields(selections, service, type, schema) {
  return [
    ...selections
      .filter(
        selection =>
          selection.kind === Kind.INLINE_FRAGMENT ||
          selection.kind === Kind.FRAGMENT_SPREAD ||
          service.typeMap[type].has(selection.name.value)
      )
      .map(selection => {
        if (selection.selectionSet && selection.selectionSet.selections) {
          if (selection.kind === Kind.INLINE_FRAGMENT) {
            const inlineFragmentType = getInlineFragmentType(
              schema,
              selection.typeCondition.name.value
            )
            const requiredFields = []

            for (const field of Object.values(inlineFragmentType.getFields())) {
              requiredFields.push(...getDirectiveSelection(field, 'requires'))
            }

            return {
              ...selection,
              selectionSet: {
                kind: Kind.SELECTION_SET,
                selections: collectServiceTypeFields(
                  [...selection.selectionSet.selections, ...requiredFields],
                  service,
                  inlineFragmentType,
                  schema
                )
              }
            }
          }

          const fieldType = getFieldType(schema, type, selection.name.value)
          const requiredFields = []

          if (fieldType.getFields) {
            for (const field of Object.values(fieldType.getFields())) {
              requiredFields.push(...getDirectiveSelection(field, 'requires'))
            }
          }

          return {
            ...selection,
            selectionSet: {
              kind: Kind.SELECTION_SET,
              selections: collectServiceTypeFields(
                [...selection.selectionSet.selections, ...requiredFields],
                service,
                fieldType,
                schema
              )
            }
          }
        }

        return selection
      }),
    {
      kind: Kind.FIELD,
      name: {
        kind: Kind.NAME,
        value: '__typename'
      },
      arguments: [],
      directives: []
    },
    ...getDirectiveSelection(type, 'key'),
    ...getDirectiveRequiresSelection(selections, type)
  ]
}

function createQueryOperation({
  fieldName,
  selections,
  variableDefinitions,
  args,
  operation
}) {
  return {
    kind: Kind.DOCUMENT,
    definitions: [
      {
        kind: Kind.OPERATION_DEFINITION,
        operation,
        name: {
          kind: Kind.NAME,
          value: `Query_${fieldName}`
        },
        variableDefinitions,
        directives: [],
        selectionSet: {
          kind: Kind.SELECTION_SET,
          selections: [
            {
              kind: Kind.FIELD,
              name: {
                kind: Kind.NAME,
                value: fieldName
              },
              arguments: args,
              directives: [],
              selectionSet: {
                kind: Kind.SELECTION_SET,
                selections
              }
            }
          ]
        }
      }
    ]
  }
}

function createEntityReferenceResolverOperation({
  returnType,
  selections,
  variableDefinitions
}) {
  return {
    kind: Kind.DOCUMENT,
    definitions: [
      {
        kind: Kind.OPERATION_DEFINITION,
        operation: 'query',
        name: {
          kind: Kind.NAME,
          value: 'EntitiesQuery'
        },
        variableDefinitions: [
          ...variableDefinitions,
          {
            kind: Kind.VARIABLE_DEFINITION,
            variable: {
              kind: Kind.VARIABLE,
              name: {
                kind: Kind.NAME,
                value: 'representations'
              }
            },
            type: {
              kind: Kind.NON_NULL_TYPE,
              type: {
                kind: Kind.LIST_TYPE,
                type: {
                  kind: Kind.NON_NULL_TYPE,
                  type: {
                    kind: Kind.NAMED_TYPE,
                    name: {
                      kind: Kind.NAME,
                      value: '_Any'
                    }
                  }
                }
              }
            },
            directives: []
          }
        ],
        directives: [],
        selectionSet: {
          kind: Kind.SELECTION_SET,
          selections: [
            {
              kind: Kind.FIELD,
              name: {
                kind: Kind.NAME,
                value: '_entities'
              },
              arguments: [
                {
                  kind: Kind.ARGUMENT,
                  name: {
                    kind: Kind.NAME,
                    value: 'representations'
                  },
                  value: {
                    kind: Kind.VARIABLE,
                    name: {
                      kind: Kind.NAME,
                      value: 'representations'
                    }
                  }
                }
              ],
              directives: [],
              selectionSet: {
                kind: Kind.SELECTION_SET,
                selections: [
                  {
                    kind: Kind.FIELD,
                    name: {
                      kind: Kind.NAME,
                      value: '__typename'
                    },
                    arguments: [],
                    directives: []
                  },
                  {
                    kind: Kind.INLINE_FRAGMENT,
                    typeCondition: {
                      kind: Kind.NAMED_TYPE,
                      name: {
                        kind: Kind.NAME,
                        value: returnType
                      }
                    },
                    directives: [],
                    selectionSet: {
                      kind: Kind.SELECTION_SET,
                      selections
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}

function createFieldResolverOperation({
  parentType,
  fieldName,
  selections,
  args,
  variableDefinitions
}) {
  return createEntityReferenceResolverOperation({
    returnType: parentType,
    variableDefinitions,
    selections: [
      {
        kind: Kind.FIELD,
        name: {
          kind: Kind.NAME,
          value: fieldName
        },
        directives: [],
        selectionSet: {
          kind: Kind.SELECTION_SET,
          selections
        },
        arguments: args
      }
    ]
  })
}

function collectVariableNames(acc, fields) {
  for (const field of fields) {
    if (field.value.kind === Kind.VARIABLE) {
      acc.push(field.value.name.value)
    } else if (field.value.kind === Kind.OBJECT) {
      collectVariableNames(acc, field.value.fields)
    }
  }
}

function collectArgumentNames(fieldNode) {
  const argumentNames = []

  if (fieldNode.arguments) {
    for (const argument of fieldNode.arguments) {
      /* istanbul ignore else if there is no arguments property we return empty array */
      if (argument.value.kind === Kind.VARIABLE) {
        argumentNames.push(argument.value.name.value)
      } else if (argument.value.kind === Kind.OBJECT) {
        collectVariableNames(argumentNames, argument.value.fields)
      } else if (argument.value.kind === Kind.LIST) {
        /* c8 ignore next 3 */
        // TODO: Support GraphQL List
      }
    }
  }

  return argumentNames
}

function collectArgumentsWithVariableValues(selections) {
  const argumentNames = []

  for (const selection of selections) {
    argumentNames.push(...collectArgumentNames(selection))

    if (selection.directives.length > 0) {
      for (const directive of selection.directives) {
        argumentNames.push(...collectArgumentNames(directive))
      }
    }

    if (selection.selectionSet && selection.selectionSet.selections) {
      argumentNames.push(
        ...collectArgumentsWithVariableValues(selection.selectionSet.selections)
      )
    }
  }

  return argumentNames
}

function getFragmentNamesInSelection(selections) {
  const fragmentsInSelection = []

  for (const selection of selections) {
    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      fragmentsInSelection.push(selection.name.value)
    }

    if (selection.selectionSet) {
      fragmentsInSelection.push(
        ...getFragmentNamesInSelection(selection.selectionSet.selections)
      )
    }
  }

  return fragmentsInSelection
}

function collectFragmentsToInclude(usedFragments, fragments, service, schema) {
  const visitedFragments = new Set()
  const result = []

  for (const fragmentName of usedFragments) {
    visitedFragments.add(fragmentName)
    const fragment = fragments[fragmentName]
    const selections = collectServiceTypeFields(
      fragment.selectionSet.selections,
      service,
      fragment.typeCondition.name.value,
      schema
    )

    result.push({
      ...fragment,
      selectionSet: {
        kind: Kind.SELECTION_SET,
        selections
      }
    })

    const fragmentsInSelections = getFragmentNamesInSelection(
      selections
    ).filter(fragmentName => !visitedFragments.has(fragmentName))
    result.push(
      ...collectFragmentsToInclude(
        fragmentsInSelections,
        fragments,
        service,
        schema
      )
    )
  }

  return result
}

function generatePathKey(path) {
  const keys = []
  if (path.prev) {
    keys.push(...generatePathKey(path.prev))
  }

  keys.push(path.key)

  return keys
}

function getCached(context, resolverKey, lruGatewayResolvers) {
  return (
    lruGatewayResolvers != null &&
    lruGatewayResolvers.get(`${context.__currentQuery}_${resolverKey}`)
  )
}

function getReferences(info) {
  const type = getNamedType(info.returnType)

  const queryId = generatePathKey(info.path).join('.')
  const resolverKey = `${queryId}.${type.toString()}`

  return { type, queryId, resolverKey }
}

function removeNonIdProperties(obj, type) {
  const keyDirective = type.astNode.directives.find(d => d.name.value === 'key')

  if (!keyDirective) {
    throw new MER_ERR_GQL_GATEWAY_MISSING_KEY_DIRECTIVE(type.name)
  }

  const idFields = keyDirective.arguments[0].value.value.split(' ')

  const result = {
    __typename: obj.__typename
  }

  for (const id of idFields) {
    result[id] = obj[id]
  }

  return result
}

function getRequiredFields(obj, field) {
  const requiresDirective = field.astNode.directives.find(
    d => d.name.value === 'requires'
  )
  const result = {}

  if (!requiresDirective) {
    return result
  }

  const requiredFields = requiresDirective.arguments[0].value.value.split(' ')

  for (const requiredField of requiredFields) {
    result[requiredField] = obj[requiredField]
  }

  return result
}

function appendFragments(query, fragmentsToDefine) {
  /* istanbul ignore else */
  if (fragmentsToDefine.length > 0) {
    const fragmentsIncluded = new Set()
    for (const fragment of fragmentsToDefine) {
      if (!fragmentsIncluded.has(fragment.name.value)) {
        query += `\n${print(fragment)}`
        fragmentsIncluded.add(fragment.name.value)
      }
    }
  }

  return query
}

module.exports = {
  getCached,
  getReferences,
  collectArgumentsWithVariableValues,
  collectFragmentsToInclude,
  collectServiceTypeFields,
  getFragmentNamesInSelection,
  collectArgumentNames,
  removeNonIdProperties,
  getRequiredFields,
  appendFragments,
  createQueryOperation,
  createFieldResolverOperation,
  createEntityReferenceResolverOperation,
  kEntityResolvers
}
