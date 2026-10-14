/**
 * Apple App Store storefront ID → ISO 3166-1 alpha-2 territory.
 * Keys/titles verified against the live App Store Connect analytics API
 * (timeseries grouped by storefront returns all 175). IDs are stable;
 * unknown keys must fall back to "ZZ", never crash the sync.
 */
const STOREFRONT_TO_TERRITORY: Record<string, string> = {
  "143610": "AF", // Afghanistan
  "143575": "AL", // Albania
  "143563": "DZ", // Algeria
  "143564": "AO", // Angola
  "143538": "AI", // Anguilla
  "143540": "AG", // Antigua and Barbuda
  "143505": "AR", // Argentina
  "143524": "AM", // Armenia
  "143460": "AU", // Australia
  "143445": "AT", // Austria
  "143568": "AZ", // Azerbaijan
  "143539": "BS", // Bahamas
  "143559": "BH", // Bahrain
  "143541": "BB", // Barbados
  "143565": "BY", // Belarus
  "143446": "BE", // Belgium
  "143555": "BZ", // Belize
  "143576": "BJ", // Benin
  "143542": "BM", // Bermuda
  "143577": "BT", // Bhutan
  "143556": "BO", // Bolivia
  "143612": "BA", // Bosnia and Herzegovina
  "143525": "BW", // Botswana
  "143503": "BR", // Brazil
  "143543": "VG", // British Virgin Islands
  "143560": "BN", // Brunei
  "143526": "BG", // Bulgaria
  "143578": "BF", // Burkina Faso
  "143579": "KH", // Cambodia
  "143574": "CM", // Cameroon
  "143455": "CA", // Canada
  "143580": "CV", // Cape Verde
  "143544": "KY", // Cayman Islands
  "143581": "TD", // Chad
  "143483": "CL", // Chile
  "143465": "CN", // China mainland
  "143501": "CO", // Colombia
  "143613": "CD", // Congo, Democratic Republic of the
  "143582": "CG", // Congo, Republic of the
  "143495": "CR", // Costa Rica
  "143527": "CI", // Côte d'Ivoire
  "143494": "HR", // Croatia
  "143557": "CY", // Cyprus
  "143489": "CZ", // Czech Republic
  "143458": "DK", // Denmark
  "143545": "DM", // Dominica
  "143508": "DO", // Dominican Republic
  "143509": "EC", // Ecuador
  "143516": "EG", // Egypt
  "143506": "SV", // El Salvador
  "143518": "EE", // Estonia
  "143602": "SZ", // Eswatini
  "143583": "FJ", // Fiji
  "143447": "FI", // Finland
  "143442": "FR", // France
  "143614": "GA", // Gabon
  "143584": "GM", // Gambia
  "143615": "GE", // Georgia
  "143443": "DE", // Germany
  "143573": "GH", // Ghana
  "143448": "GR", // Greece
  "143546": "GD", // Grenada
  "143504": "GT", // Guatemala
  "143585": "GW", // Guinea-Bissau
  "143553": "GY", // Guyana
  "143510": "HN", // Honduras
  "143463": "HK", // Hong Kong
  "143482": "HU", // Hungary
  "143558": "IS", // Iceland
  "143467": "IN", // India
  "143476": "ID", // Indonesia
  "143617": "IQ", // Iraq
  "143449": "IE", // Ireland
  "143491": "IL", // Israel
  "143450": "IT", // Italy
  "143511": "JM", // Jamaica
  "143462": "JP", // Japan
  "143528": "JO", // Jordan
  "143517": "KZ", // Kazakhstan
  "143529": "KE", // Kenya
  "143466": "KR", // Korea, Republic of
  "143624": "XK", // Kosovo (user-assigned, no ISO code)
  "143493": "KW", // Kuwait
  "143586": "KG", // Kyrgyzstan
  "143587": "LA", // Laos
  "143519": "LV", // Latvia
  "143497": "LB", // Lebanon
  "143588": "LR", // Liberia
  "143567": "LY", // Libya
  "143520": "LT", // Lithuania
  "143451": "LU", // Luxembourg
  "143515": "MO", // Macau
  "143531": "MG", // Madagascar
  "143589": "MW", // Malawi
  "143473": "MY", // Malaysia
  "143488": "MV", // Maldives
  "143532": "ML", // Mali
  "143521": "MT", // Malta
  "143590": "MR", // Mauritania
  "143533": "MU", // Mauritius
  "143468": "MX", // Mexico
  "143591": "FM", // Micronesia
  "143523": "MD", // Moldova
  "143592": "MN", // Mongolia
  "143619": "ME", // Montenegro
  "143547": "MS", // Montserrat
  "143620": "MA", // Morocco
  "143593": "MZ", // Mozambique
  "143570": "MM", // Myanmar
  "143594": "NA", // Namibia
  "143606": "NR", // Nauru
  "143484": "NP", // Nepal
  "143452": "NL", // Netherlands
  "143461": "NZ", // New Zealand
  "143512": "NI", // Nicaragua
  "143534": "NE", // Niger
  "143561": "NG", // Nigeria
  "143530": "MK", // North Macedonia
  "143457": "NO", // Norway
  "143562": "OM", // Oman
  "143477": "PK", // Pakistan
  "143595": "PW", // Palau
  "143485": "PA", // Panama
  "143597": "PG", // Papua New Guinea
  "143513": "PY", // Paraguay
  "143507": "PE", // Peru
  "143474": "PH", // Philippines
  "143478": "PL", // Poland
  "143453": "PT", // Portugal
  "143498": "QA", // Qatar
  "143487": "RO", // Romania
  "143469": "RU", // Russia
  "143621": "RW", // Rwanda
  "143598": "ST", // São Tomé and Príncipe
  "143479": "SA", // Saudi Arabia
  "143535": "SN", // Senegal
  "143500": "RS", // Serbia
  "143599": "SC", // Seychelles
  "143600": "SL", // Sierra Leone
  "143464": "SG", // Singapore
  "143496": "SK", // Slovakia
  "143499": "SI", // Slovenia
  "143601": "SB", // Solomon Islands
  "143472": "ZA", // South Africa
  "143454": "ES", // Spain
  "143486": "LK", // Sri Lanka
  "143548": "KN", // St. Kitts and Nevis
  "143549": "LC", // St. Lucia
  "143550": "VC", // St. Vincent and the Grenadines
  "143554": "SR", // Suriname
  "143456": "SE", // Sweden
  "143459": "CH", // Switzerland
  "143470": "TW", // Taiwan
  "143603": "TJ", // Tajikistan
  "143572": "TZ", // Tanzania
  "143475": "TH", // Thailand
  "143608": "TO", // Tonga
  "143551": "TT", // Trinidad and Tobago
  "143536": "TN", // Tunisia
  "143480": "TR", // Türkiye
  "143604": "TM", // Turkmenistan
  "143552": "TC", // Turks and Caicos Islands
  "143537": "UG", // Uganda
  "143492": "UA", // Ukraine
  "143481": "AE", // United Arab Emirates
  "143444": "GB", // United Kingdom
  "143441": "US", // United States
  "143514": "UY", // Uruguay
  "143566": "UZ", // Uzbekistan
  "143609": "VU", // Vanuatu
  "143502": "VE", // Venezuela
  "143471": "VN", // Vietnam
  "143571": "YE", // Yemen
  "143622": "ZM", // Zambia
  "143605": "ZW", // Zimbabwe
};

/** Maps a storefront key to its territory, or null when Apple added an unknown one. */
export function storefrontToTerritory(key: string | null | undefined): string | null {
  if (!key) return null;
  return STOREFRONT_TO_TERRITORY[String(key)] ?? null;
}

/** Number of known storefronts (Apple reports 175). */
export function storefrontCount(): number {
  return Object.keys(STOREFRONT_TO_TERRITORY).length;
}
