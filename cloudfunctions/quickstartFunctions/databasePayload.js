const withoutDocumentId = (record = {}) => {
  const payload = { ...(record || {}) };
  delete payload._id;
  return payload;
};

module.exports = {
  withoutDocumentId,
};
