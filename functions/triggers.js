const functions = require('firebase-functions')

const streetSwipeDAG = require('./streetswipe-dag')

// setNextAnnotations: async function (poiId, types) {
//   const poiRef = this.getPoiRef(poiId)
//   const nextAnnotations = Object.assign(...types.map((type) => ({[`annotations.${type}`]: 0})))
//   const updatedPoiRef = await poiRef.update(nextAnnotations)
//   return updatedPoiRef
// },

const getPoiRef = (db, poiId) => db.collection('pois').doc(poiId)
const getAggregatedAnnotationsRef = (db) => db.collection('aggregates').doc('annotations')

async function updateAnnotationCount (db, poiId, type, data, increment) {
  const poiRef = getPoiRef(db, poiId)
  const aggregatedAnnotationsRef = getAggregatedAnnotationsRef(db)

  return db.runTransaction(async (transaction) => {
    const poiDoc = await transaction.get(poiRef)

    const aggregatedAnnotationsDoc = await transaction.get(aggregatedAnnotationsRef)
    let aggregatedAnnotations = aggregatedAnnotationsDoc.data() || {}

    let nextAnnotations = {}

    if (data && streetSwipeDAG[type]) {
      for (let [nextType, testAnnotation] of Object.entries(streetSwipeDAG[type])) {
        if (testAnnotation(data)) {
          nextAnnotations[`annotations.${nextType}`] = 0

          const nextTypeAggregatedAnnotations = aggregatedAnnotations[nextType] || {}
          aggregatedAnnotations = {
            ...aggregatedAnnotations,
            [nextType]: {
              ...nextTypeAggregatedAnnotations,
              0: (nextTypeAggregatedAnnotations[0] || 0) + 1
            }
          }
        }
      }
    }

    // Add field nextAnnotations = ['facade', 'check'] ??

    let updatedPoiRef
    if (increment !== undefined) {
      const currentAnnotations = poiDoc.data().annotations || {}
      const count = (currentAnnotations[type]) || 0
      const newCount = count + increment

      const typeAggregatedAnnotations = aggregatedAnnotations[type] || {}
      aggregatedAnnotations = {
        ...aggregatedAnnotations,
        [type]: {
          ...typeAggregatedAnnotations,
          [count]: (typeAggregatedAnnotations[count] || 1) - 1,
          [newCount]: (typeAggregatedAnnotations[newCount] || 0) + 1
        }
      }

      await transaction.update(aggregatedAnnotationsRef, aggregatedAnnotations)

      updatedPoiRef = await transaction.update(poiRef, {
        ...nextAnnotations,
        [`annotations.${type}`]: newCount
      })
    }

    return updatedPoiRef
  })
}

module.exports = function (db) {
  const watchAnnotations = functions.firestore
    .document('pois/{poiId}/annotations/{annotationId}')
    .onWrite(async (change, context) => {
      const poiId = context.params.poiId

      const dataBefore = change.before.data()
      const dataAfter = change.after.data()

      let updatedPoiRef

      if (dataBefore && dataAfter) {
        // Annotation updated
        const type = dataAfter.type
        updatedPoiRef = await updateAnnotationCount(db, poiId, type, dataAfter, 0)
      } else if (dataAfter) {
        // Annotation created
        const type = dataAfter.type
        updatedPoiRef = await updateAnnotationCount(db, poiId, type, dataAfter, 1)
      } else {
        // Annotation deleted
        const type = dataBefore.type
        updatedPoiRef = await updateAnnotationCount(db, poiId, type, undefined, -1)
      }

      return updatedPoiRef
    })

  return {
    watchAnnotations
  }
}
