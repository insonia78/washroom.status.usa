export function requestCurrentPosition(
  geolocation: Geolocation,
  isCurrent: () => boolean,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, error => {
      if (!isCurrent() || error.code === error.PERMISSION_DENIED) {
        reject(error);
        return;
      }
      geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 15_000,
        maximumAge: 60_000,
      });
    }, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 60_000,
    });
  });
}
