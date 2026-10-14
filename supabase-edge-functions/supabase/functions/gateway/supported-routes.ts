export const supportedRoutes = [
  {
    pattern: /^\/health\/?$/,
    methods: [
      "GET"
    ]
  },
  {
    pattern: /^\/accounts\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/login\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/access\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/password\/setup\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/reset-password\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/reset-password\/confirm\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/deactivate\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/accounts\/\d+\/?$/,
    methods: [
      "PUT",
      "PATCH",
      "DELETE"
    ]
  },
  {
    pattern: /^\/auth\/logout\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/weather\/status\/?$/,
    methods: [
      "GET"
    ]
  },
  {
    pattern: /^\/weather\/search\/?$/,
    methods: [
      "GET"
    ]
  },
  {
    pattern: /^\/weather\/reverse\/?$/,
    methods: [
      "GET"
    ]
  },
  {
    pattern: /^\/weather\/dashboard\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/weather\/map-layers\/(clouds_new|precipitation_new|temp_new|wind_new)\/\d+\/\d+\/\d+\/?$/,
    methods: [
      "GET"
    ]
  },
  {
    pattern: /^\/admin\/dashboard\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/admin\/dashboard\/stream\/?$/,
    methods: [
      "GET"
    ]
  },
  {
    pattern: /^\/admin\/access\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/admin\/login\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/admin\/create-password\/?$/,
    methods: [
      "POST"
    ]
  },
  {
    pattern: /^\/weather\/search-history\/?$/,
    methods: [
      "GET",
      "POST",
      "DELETE"
    ]
  },
  {
    pattern: /^\/weather\/profile\/?$/,
    methods: [
      "GET",
      "PUT",
      "DELETE"
    ]
  }
];
