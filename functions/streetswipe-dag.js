module.exports = {
  osm: {
    address: (annotation) => true
  },
  failliesementsdossiers: {
    address: (annotation) => true
  },
  address: {
    screenshot: (annotation) => annotation.data.address
  },
  screenshot: {
    facade: (annotation) => annotation.data.screenshotUrl
  },
  check: {
    facade: (annotation) => annotation.data.valid
  },
  facade: {
    mask: (annotation) => annotation.data.mask
  }
}
