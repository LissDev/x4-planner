export function localizedName(record, locale = 'en') {
  return locale === 'ru' ? record.name : record.nameEn;
}

export function formatNumber(value, locale = 'en', options = {}) {
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', options).format(value);
}
