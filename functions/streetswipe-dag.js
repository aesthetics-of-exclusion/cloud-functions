module.exports = {
  osm: {
    address: (annotation) => true
  },
  faillissementsdossier: {
    address: (annotation) => true
  },
  address: {
    screenshot: (annotation) => annotation.data.address
  },
  screenshot: {
    check: (annotation) => annotation.data.screenshotUrl
  },
  check: {
    facade: (annotation) => annotation.data.valid
  },
  facade: {
    mask: (annotation) => annotation.data.mask
  }
}
