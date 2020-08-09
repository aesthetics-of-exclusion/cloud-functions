const admin = require('firebase-admin')
const FieldValue = admin.firestore.FieldValue

const functions = require('firebase-functions')

const streetSwipeDAG = require('./streetswipe-dag')

const getPoiRef = (db, poiId) => db.collection('pois').doc(poiId)
const getAggregatedAnnotationsRef = (db) => db.collection('aggregates').doc('annotations')

/* eslint-disable no-await-in-loop */
async function deleteNextAnnotation (db, poiId, type) {
  if (streetSwipeDAG[type]) {
    return db.runTransaction(async (transaction) => {
      for (let nextType of Object.keys(streetSwipeDAG[type])) {
        console.log(`Delete annotations from POI ${poiId} of type ${nextType}`)

        const poiRef = getPoiRef(db, poiId)
        await poiRef.update({
          [`annotations.${nextType}`]: FieldValue.delete()
        })

        const query = db.collectionGroup('annotations')
          .where('poiId', '==', poiId)
          .where('type', '==', nextType)

        const snapshot = await query.get()

        if (snapshot.empty) {
          console.log('No annotations found')
          break
        }

        const deletes = []
        snapshot.forEach((annotation) => {
          deletes.push(transaction.delete(annotation.ref))
        })

        await Promise.all(deletes)
      }
    })
  }
}

async function annotationUpdated (db, poiId, type, annotationData) {
  await deleteNextAnnotation(db, poiId, type)
  const transactionResult = await updateAnnotationAggregates(db, poiId, type, annotationData, 0)
  return transactionResult
}

async function annotationAdded (db, poiId, type, annotationData) {
  await deleteNextAnnotation(db, poiId, type)
  const transactionResult = await updateAnnotationAggregates(db, poiId, type, annotationData, 1)
  return transactionResult
}

async function annotationDeleted (db, poiId, type, annotationData) {
  await deleteNextAnnotation(db, poiId, type)
  const transactionResult = await updateAnnotationAggregates(db, poiId, type, annotationData, -1)
  return transactionResult
}

async function updateAnnotationAggregates (db, poiId, type, annotationData, increment) {
  const aggregatedAnnotationsRef = getAggregatedAnnotationsRef(db)

  return db.runTransaction(async (transaction) => {
    const aggregatedAnnotationsDoc = await transaction.get(aggregatedAnnotationsRef)
    let aggregatedAnnotations = aggregatedAnnotationsDoc.data() || {}

    let nextAnnotations = {}

    if (annotationData && streetSwipeDAG[type]) {
      for (let [nextType, testAnnotation] of Object.entries(streetSwipeDAG[type])) {
        if (testAnnotation(annotationData)) {
          // TODO: check current value of nextAnnotations[`annotations.${nextType}`]
          nextAnnotations[`annotations.${nextType}`] = 0

          const nextTypeAggregatedAnnotations = aggregatedAnnotations[nextType] || {}
          aggregatedAnnotations = {
            ...aggregatedAnnotations,
            [nextType]: {
              ...nextTypeAggregatedAnnotations,
              // TODO: if current value exists, decrement value
              0: (nextTypeAggregatedAnnotations[0] || 0) + 1
            }
          }
        }
      }
    }

    const poiRef = getPoiRef(db, poiId)
    const poiDoc = await poiRef.get()
    const poi = poiDoc.exists && poiDoc.data()

    const currentAnnotations = (poi && poi.annotations) || {}

    const count = (currentAnnotations[type]) || 0
    const newCount = Math.max(count + increment, 0)

    // Update aggregated annotations:
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

    // Update POI annotation count:
    if (poiDoc.exists) {
      await transaction.update(poiRef, {
        ...nextAnnotations,
        [`annotations.${type}`]: newCount
      })
    }
  })
}

module.exports = function (db) {
  const watchAnnotations = functions.firestore
    .document('pois/{poiId}/annotations/{annotationId}')
    .onWrite(async (change, context) => {
      const poiId = context.params.poiId

      const dataBefore = change.before.data()
      const dataAfter = change.after.data()

      let transactionResult

      if (dataBefore && dataAfter) {
        // Annotation updated
        const type = dataAfter.type
        transactionResult = await annotationUpdated(db, poiId, type, dataAfter)
      } else if (dataAfter) {
        // Annotation created
        const type = dataAfter.type
        transactionResult = await annotationAdded(db, poiId, type, dataAfter)
      } else {
        // Annotation deleted
        const type = dataBefore.type
        transactionResult = await annotationDeleted(db, poiId, type, dataBefore)
      }

      return transactionResult
    })

  return {
    watchAnnotations
  }
}
