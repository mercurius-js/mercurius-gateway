'use strict'

const { getNamedType, print, parse, Kind, isUnionType } = require('graphql')
const {
  preGatewayExecutionHandler,
  preGatewaySubscriptionExecutionHandler
} = require('../handlers')
const { collect } = require('../collectors')
const { MER_ERR_GQL_GATEWAY_MISSING_KEY_DIRECTIVE } = require('../errors')

const kEntityResolvers = Symbol('mercurius.entity-resolvers')

function getFieldType (schema, type, fieldName) {
  return getNamedType(schema.getType(type).getFields()[fieldName].type)
}

function getInlineFragmentType (schema, type) {
  return getNamedType(schema.getType(type))
}

function getDirectiveSelection (node, directiveName) {
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

function getDirectiveRequiresSelection (selections, type) {
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

function collectServiceTypeFields (selections, service, type, schema) {
  return [
    ...selections
      .filter(
        selection =>
          selection.kind === Kind.INLINE_FRAGMENT ||
          selection.kind === Kind.FRAGMENT_SPREAD ||
          (service.typeMap[type] && service.typeMap[type].has(selection.name.value))
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

function createQueryOperation ({
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

function createEntityReferenceResolverOperation ({
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

function createFieldResolverOperation ({
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

function collectVariableNames (acc, fields) {
  for (const field of fields) {
    if (field.value.kind === Kind.VARIABLE) {
      acc.push(field.value.name.value)
    } else if (field.value.kind === Kind.OBJECT) {
      collectVariableNames(acc, field.value.fields)
    }
  }
}

function collectArgumentNames (fieldNode) {
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

function collectArgumentsWithVariableValues (selections) {
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

function getFragmentNamesInSelection (selections) {
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

function collectFragmentsToInclude (usedFragments, fragments, service, schema) {
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

function generatePathKey (path) {
  const keys = []
  if (path.prev) {
    keys.push(...generatePathKey(path.prev))
  }

  keys.push(path.key)

  return keys
}

function getSelectionsForType (selections, targetTypeName, fragments) {
  const result = []
  for (const selection of selections) {
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      if (selection.typeCondition.name.value === targetTypeName) {
        result.push(...selection.selectionSet.selections)
      }
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragment = fragments[selection.name.value]
      if (fragment && fragment.typeCondition.name.value === targetTypeName) {
        result.push(selection)
      }
    } else {
      result.push(selection)
    }
  }
  return result
}

async function resolveNestedUnionFields ({
  toFill,
  schema,
  fieldNodes,
  fragments,
  typeToServiceMap,
  service,
  serviceMap,
  entityResolvers,
  variableValues,
  originalVariableDefinitions,
  context,
  queryId
}) {
  for (let i = 0; i < toFill.length; i++) {
    const item = toFill[i]
    if (!item || !item.__typename) continue

    const schemaType = schema.getType(item.__typename)
    /* istanbul ignore next */
    if (!schemaType || !schemaType.getFields) continue

    const typeFields = schemaType.getFields()
    for (const nestedFieldName in typeFields) {
      const nestedFieldDef = typeFields[nestedFieldName]
      const namedType = getNamedType(nestedFieldDef.type)
      if (!isUnionType(namedType)) continue

      // Get nested values (single or array)
      const nestedValue = item[nestedFieldName]
      if (!nestedValue) continue
      const isNestedArray = Array.isArray(nestedValue)
      const nestedItems = isNestedArray ? nestedValue : [nestedValue]

      // Group nested items by __typename that belong to a different service
      const nestedTypeGroups = {}
      for (let ni = 0; ni < nestedItems.length; ni++) {
        const nested = nestedItems[ni]
        if (!nested || !nested.__typename) continue
        const nestedTypeName = nested.__typename
        const nestedTargetService = typeToServiceMap[nestedTypeName]
        if (!nestedTargetService || nestedTargetService === service.name) continue
        if (!nestedTypeGroups[nestedTypeName]) {
          nestedTypeGroups[nestedTypeName] = { targetService: nestedTargetService, indices: [] }
        }
        nestedTypeGroups[nestedTypeName].indices.push(ni)
      }

      if (Object.keys(nestedTypeGroups).length === 0) continue

      // Find the selection set for this nested field from the original query
      let nestedFieldSelections = null
      /* istanbul ignore next */
      if (fieldNodes[0].selectionSet && fieldNodes[0].selectionSet.selections) {
        for (const sel of fieldNodes[0].selectionSet.selections) {
          if (sel.kind === Kind.FIELD && sel.name.value === nestedFieldName && sel.selectionSet) {
            nestedFieldSelections = sel.selectionSet.selections
            break
          }
          // Also look inside inline fragments (for union parent types)
          if (sel.kind === Kind.INLINE_FRAGMENT && sel.selectionSet) {
            for (const innerSel of sel.selectionSet.selections) {
              if (innerSel.kind === Kind.FIELD && innerSel.name.value === nestedFieldName && innerSel.selectionSet) {
                nestedFieldSelections = innerSel.selectionSet.selections
                break
              }
            }
            if (nestedFieldSelections) break
          }
          // Also look inside named fragments (fragment spreads)
          if (sel.kind === Kind.FRAGMENT_SPREAD) {
            const fragment = fragments[sel.name.value]
            if (fragment && fragment.selectionSet) {
              for (const innerSel of fragment.selectionSet.selections) {
                if (innerSel.kind === Kind.FIELD && innerSel.name.value === nestedFieldName && innerSel.selectionSet) {
                  nestedFieldSelections = innerSel.selectionSet.selections
                  break
                }
              }
              if (nestedFieldSelections) break
            }
          }
        }
      }
      // Defensive guard: unreachable in practice because GraphQL servers only
      // return fields present in the client query, so nestedValue at line 492
      // would be undefined before we get here. Kept for safety.
      /* istanbul ignore next */
      if (!nestedFieldSelections) continue

      // Skip the standard resolver logic to avoid expensive per-field requests
      // to other services. Entity data loaders do not support resolving union
      // members across services, so we issue direct _entities requests instead.
      for (const nestedTypeName in nestedTypeGroups) {
        const nestedGroup = nestedTypeGroups[nestedTypeName]
        const nestedTypeSelections = getSelectionsForType(
          nestedFieldSelections,
          nestedTypeName,
          fragments
        )

        const filteredSelections = collectServiceTypeFields(
          nestedTypeSelections,
          serviceMap[nestedGroup.targetService],
          schema.getType(nestedTypeName),
          schema
        )

        const reps = nestedGroup.indices.map(ni =>
          removeNonIdProperties(nestedItems[ni], schema.getType(nestedTypeName))
        )

        const nestedUnionVarNames = new Set(collectArgumentsWithVariableValues(filteredSelections))
        const nestedUnionVarDefs = originalVariableDefinitions.filter(
          def => nestedUnionVarNames.has(def.variable.name.value)
        )
        const nestedEntityVars = { representations: reps }
        for (const name of nestedUnionVarNames) {
          // GraphQL validates that all referenced variables are provided,
          // so this check is purely defensive.
          /* istanbul ignore next */
          if (name in variableValues) {
            nestedEntityVars[name] = variableValues[name]
          }
        }

        const operation = createEntityReferenceResolverOperation({
          returnType: nestedTypeName,
          selections: filteredSelections,
          variableDefinitions: nestedUnionVarDefs
        })

        const existingValues = Object.keys(reps[0])
        const fieldsInRequest = filteredSelections
          .map(sel => sel.name && sel.name.value)
          .filter(value => value && !existingValues.includes(value))

        const queryBySelections = print(operation)

        const usedFragments = getFragmentNamesInSelection(filteredSelections)
        const fragmentsToDefine = collectFragmentsToInclude(
          usedFragments,
          fragments,
          serviceMap[nestedGroup.targetService],
          schema
        )
        const finalQuery = appendFragments(queryBySelections, fragmentsToDefine)

        let entities
        if (!fieldsInRequest.length && finalQuery === queryBySelections) {
          entities = reps
        } else {
          const responseEntityResolver = await entityResolvers[`${nestedGroup.targetService}Entity`]({
            document: operation,
            query: finalQuery,
            variables: nestedEntityVars,
            context,
            id: queryId
          })

          entities = responseEntityResolver.json.data._entities
        }

        for (let j = 0; j < entities.length; j++) {
          const entity = entities[j]
          if (entity == null) {
            if (isNestedArray) {
              nestedItems[nestedGroup.indices[j]] = null
            } else {
              item[nestedFieldName] = null
            }
            continue
          }
          Object.assign(nestedItems[nestedGroup.indices[j]], entity)
        }
      }
    }
  }
}

/**
 * Creates a resolver function for a fields type
 *
 * There are 3 options:
 *  - Query field resolver: when the service of the type is null
 *  - Reference entity resolver: when the service of type defined the field on the type
 *  - Field entity resolver: when the field was added through type extension in the service of the field's type
 *
 */
function makeResolver ({
  service,
  createOperation,
  transformData,
  isQuery,
  isReference,
  isSubscription,
  typeToServiceMap,
  serviceMap,
  entityResolversFactory,
  lruGatewayResolvers,
  skipRequestIfValueExists
}) {
  return async function (parent, args, context, info) {
    const {
      fieldNodes,
      returnType,
      fieldName,
      parentType,
      operation: originalOperation,
      variableValues,
      fragments,
      schema
    } = info

    if (isReference && !parent[fieldName]) return null

    // Get the actual type as the returnType can be NonNull or List as well
    const type = getNamedType(returnType)

    const queryId = generatePathKey(info.path).join('.')
    const resolverKey = `${queryId}.${type.toString()}`
    const { reply, __currentQuery, pubsub } = context

    const cached =
      lruGatewayResolvers != null &&
      lruGatewayResolvers.get(`${__currentQuery}_${resolverKey}`)
    let variableNamesToDefine
    let operation
    let query
    let selections

    // verify and return the value if is already available in the parent
    if (parent && parent[fieldName] && skipRequestIfValueExists) {
      return parent[fieldName]
    }

    if (cached) {
      variableNamesToDefine = cached.variableNamesToDefine
      query = cached.query
      operation = cached.operation
    } else {
      // Remove items from selections that are not defined in the service
      selections = fieldNodes[0].selectionSet
        ? collectServiceTypeFields(
          fieldNodes[0].selectionSet.selections,
          service,
          type,
          schema
        )
        : []

      // collect all variable names that are used in selection
      variableNamesToDefine = new Set(
        collectArgumentsWithVariableValues(selections)
      )
      collectArgumentNames(fieldNodes[0]).map(argumentName =>
        variableNamesToDefine.add(argumentName)
      )
      const variablesToDefine = originalOperation.variableDefinitions.filter(
        definition => variableNamesToDefine.has(definition.variable.name.value)
      )

      // create the operation that will be sent to the service
      operation = createOperation({
        returnType: type,
        parentType,
        fieldName,
        selections,
        isQuery,
        isReference,
        variableDefinitions: variablesToDefine,
        args: fieldNodes[0].arguments,
        operation: originalOperation.operation
      })

      query = print(operation)

      // check if fragments are used in the original query
      const usedFragments = getFragmentNamesInSelection(selections)
      const fragmentsToDefine = collectFragmentsToInclude(
        usedFragments,
        fragments,
        service,
        schema
      )
      query = appendFragments(query, fragmentsToDefine)

      if (lruGatewayResolvers != null) {
        lruGatewayResolvers.set(`${__currentQuery}_${resolverKey}`, {
          query,
          operation,
          variableNamesToDefine
        })
      }
    }

    const variables = {}

    // Add variables to payload
    for (const [variableName, variableValue] of Object.entries(
      variableValues
    )) {
      if (variableNamesToDefine.has(variableName)) {
        variables[variableName] = variableValue
      }
    }

    if (isReference) {
      if (parent[fieldName] instanceof Array) {
        variables.representations = parent[fieldName].map(ref =>
          removeNonIdProperties(ref, type)
        )
      } else {
        variables.representations = [
          removeNonIdProperties(parent[fieldName], type)
        ]
      }
    } else if (!isQuery && !isSubscription) {
      variables.representations = [
        {
          ...removeNonIdProperties(parent, parentType),
          ...getRequiredFields(
            parent,
            schema.getType(parentType).getFields()[fieldName]
          )
        }
      ]
    }

    if (isSubscription) {
      if (context.gateway.preGatewaySubscriptionExecution !== null) {
        await preGatewaySubscriptionExecutionHandler({
          schema,
          document: operation,
          context,
          service
        })
      }
      const subscriptionId = service.createSubscription(
        query,
        variables,
        pubsub.publish.bind(pubsub),
        context
      )
      context.gateway.subscriptionMap.set(context.id, { serviceName: service.name, subscriptionId })
      return pubsub.subscribe(`${service.name}_${subscriptionId}`)
    }

    const entityResolvers =
      reply?.[kEntityResolvers] || entityResolversFactory.create()

    if (isQuery) {
      // Trigger preGatewayExecution hook
      let modifiedQuery

      if (context.gateway.preGatewayExecution !== null) {
        ;({ modifiedQuery } = await preGatewayExecutionHandler({
          schema,
          document: operation,
          context,
          service
        }))
      }

      const response = await service.sendRequest({
        method: 'POST',
        body: JSON.stringify({
          query: modifiedQuery || query,
          variables
        }),
        originalRequestHeaders: reply ? reply.request.headers : {},
        context
      })

      const collectors = service.collectors
      if (collectors) {
        collect({
          collectors,
          context,
          queryId,
          response,
          serviceName: service.name
        })
      }

      service.setResponseHeaders(reply || {})

      const transformed = transformData(response)

      if (typeToServiceMap) {
        const isTransformedArray = Array.isArray(transformed)
        const toFill = isTransformedArray ? transformed : [transformed]

        // Group items by __typename to resolve entities from different services
        const typeGroups = {}
        for (let i = 0; i < toFill.length; i++) {
          const item = toFill[i]
          if (!item || !item.__typename) continue
          const typeName = item.__typename
          const targetService = typeToServiceMap[typeName]
          if (!targetService || targetService === service.name) continue
          if (!typeGroups[typeName]) {
            typeGroups[typeName] = { targetService, indices: [] }
          }
          typeGroups[typeName].indices.push(i)
        }

        // Skip the standard resolver logic to avoid expensive per-field requests
        // to other services. Entity data loaders do not support resolving union
        // members across services, so we issue direct _entities requests instead.
        for (const typeName in typeGroups) {
          const group = typeGroups[typeName]
          const typeSelections = getSelectionsForType(
            fieldNodes[0].selectionSet.selections,
            typeName,
            fragments
          )

          const filteredSelections = collectServiceTypeFields(
            typeSelections,
            serviceMap[group.targetService],
            schema.getType(typeName),
            schema
          )

          const reps = group.indices.map(i =>
            removeNonIdProperties(toFill[i], schema.getType(typeName))
          )

          const unionVarNames = new Set(collectArgumentsWithVariableValues(filteredSelections))
          const unionVarDefs = originalOperation.variableDefinitions.filter(
            def => unionVarNames.has(def.variable.name.value)
          )
          const entityVars = { representations: reps }
          for (const name of unionVarNames) {
            // GraphQL validates that all referenced variables are provided,
            // so this check is purely defensive.
            /* istanbul ignore next */
            if (name in variableValues) {
              entityVars[name] = variableValues[name]
            }
          }

          const op = createEntityReferenceResolverOperation({
            returnType: typeName,
            selections: filteredSelections,
            variableDefinitions: unionVarDefs
          })

          const existingValues = Object.keys(reps[0])
          const fieldsInRequest = filteredSelections
            .map(sel => sel.name && sel.name.value)
            .filter(value => value && !existingValues.includes(value))

          const queryStr = print(op)

          const usedFragments = getFragmentNamesInSelection(filteredSelections)
          const fragmentsToDefine = collectFragmentsToInclude(
            usedFragments,
            fragments,
            serviceMap[group.targetService],
            schema
          )
          const finalQuery = appendFragments(queryStr, fragmentsToDefine)

          let entities
          if (!fieldsInRequest.length && finalQuery === queryStr) {
            entities = reps
          } else {
            const responseEntityResolver = await entityResolvers[`${group.targetService}Entity`]({
              document: op,
              query: finalQuery,
              variables: entityVars,
              context,
              id: queryId
            })

            entities = responseEntityResolver.json.data._entities
          }

          for (let j = 0; j < entities.length; j++) {
            const entity = entities[j]
            if (entity == null) {
              toFill[group.indices[j]] = null
              continue
            }
            Object.assign(toFill[group.indices[j]], entity)
          }
        }

        // Resolve nested union fields whose members belong to a different service
        await resolveNestedUnionFields({
          toFill,
          schema,
          fieldNodes,
          fragments,
          typeToServiceMap,
          service,
          serviceMap,
          entityResolvers,
          variableValues,
          originalVariableDefinitions: originalOperation.variableDefinitions,
          context,
          queryId
        })

        return isTransformedArray ? transformed : toFill[0]
      }

      return transformed
    }

    // This method is declared in gateway.js inside of onRequest
    // hence it's unique per request.
    const response = await entityResolvers[`${service.name}Entity`]({
      document: operation,
      query,
      variables,
      context,
      id: queryId
    })

    return transformData(response)
  }
}

function removeNonIdProperties (obj, type) {
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

function getRequiredFields (obj, field) {
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

function appendFragments (query, fragmentsToDefine) {
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
  makeResolver,
  createQueryOperation,
  createFieldResolverOperation,
  createEntityReferenceResolverOperation,
  kEntityResolvers
}
