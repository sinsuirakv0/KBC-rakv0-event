export const appState = {
  gatyaData: [],
  saleData: [],
  itemData: [],
  searchQuery: "",
  currentLocale: "ja",
  selectedUtcOffset: "local",
  scheduleOff: false,
};

export function setState(patch) {
  Object.assign(appState, patch);
  return appState;
}
