const functions = require('firebase-functions')

const streetSwipeDAG = require('./streetswipe-dag')

// setNextAnnotations: async function (poiId, types) {
//   const poiRef = this.getPoiRef(poiId)
//   const nextAnnotations = Object.assign(...types.map((type) => ({[`annotations.${type}`]: 0})))
//   const updatedPoiRef = await poiRef.update(nextAnnotations)
//   return updatedPoiRef
// },

const getPoiRef = (db, poiId) => db.collection('pois').doc(poiId)

async function updateAnnotationCount (db, poiId, data, increment) {
  const type = data.type

  const poiRef = getPoiRef(db, poiId)

  const poi = await poiRef.get()

  let nextAnnotations = {}

  if (streetSwipeDAG[type]) {
    for (let [nextType, testAnnotation] of Object.entries(streetSwipeDAG[type])) {
      if (testAnnotation(data)) {
        nextAnnotations[`annotations.${nextType}`] = 0
      }
    }
  }

  // Add field nextAnnotations = ['facade', 'check']

  let updatedPoiRef
  if (increment !== undefined) {
    const count = (poi.annotations && poi.annotations[type]) || 0
    updatedPoiRef = await poiRef.update(Object.assign({
      [`annotations.${type}`]: count + increment
    }, nextAnnotations))
  } else {
    // Delete annotation
    // updatedPoiRef = poiRef.update({
    //   [`annotations.${type}`]: FieldValue.delete()
    // })
  }

  return updatedPoiRef
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
        updatedPoiRef = await updateAnnotationCount(db, poiId, dataAfter, 0)
      } else if (dataAfter) {
        // Annotation created
        updatedPoiRef = await updateAnnotationCount(db, poiId, dataAfter, 1)
      } else {
        // Annotation deleted
        updatedPoiRef = await updateAnnotationCount(db, poiId, dataBefore, -1)
      }

      return updatedPoiRef
    })

  return {
    watchAnnotations
  }
}
