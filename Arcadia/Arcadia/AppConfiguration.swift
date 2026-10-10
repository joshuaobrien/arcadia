//
//  AppConfiguration.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//
import Foundation

struct AppConfiguration {
  let arcadiaBaseURL: URL
  let dataMode: DataMode
  let fixtureScenario: FixtureScenario

  enum DataMode: String {
    case fixtures
    case integration
    case liveReadOnly = "live-readonly"
  }

  enum FixtureScenario: String {
    case success
    case empty
    case failure
    case failureThenSuccess = "failure-then-success"
    case twoPage = "two-page"
  }

  static func load(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    bundleBaseURL: String? = Bundle.main.object(forInfoDictionaryKey: "ArcadiaBaseURL") as? String
  ) throws -> AppConfiguration {

    #if DEBUG
      let defaultMode = DataMode.fixtures
    #else
      let defaultMode = DataMode.integration
    #endif
    let modeValue = environment["ARCADIA_DATA_MODE"] ?? defaultMode.rawValue
    guard let mode = DataMode(rawValue: modeValue) else {
      throw ConfigurationError.invalidDataMode
    }
    let scenarioValue = environment["ARCADIA_FIXTURE_SCENARIO"] ?? "success"
    guard let scenario = FixtureScenario(rawValue: scenarioValue) else {
      throw ConfigurationError.invalidFixtureScenario
    }
    if mode == .fixtures {
      #if DEBUG
        return AppConfiguration(
          arcadiaBaseURL: URL(fileURLWithPath: "/"), dataMode: mode, fixtureScenario: scenario
        )
      #else
        throw ConfigurationError.fixturesRequireDebug
      #endif
    }

    #if DEBUG
      let baseURLValues = [environment["ARCADIA_BASE_URL"]]
    #else
      let baseURLValues = [environment["ARCADIA_BASE_URL"], bundleBaseURL]
    #endif
    guard
      let value =
        baseURLValues
        .compactMap({ $0 })
        .first(where: { !$0.isEmpty })
    else {
      throw ConfigurationError.missingArcadiaBaseURL
    }

    guard let url = URL(string: value), ["http", "https"].contains(url.scheme ?? ""),
      url.host != nil, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil
    else {
      throw ConfigurationError.invalidArcadiaBaseURL
    }

    return AppConfiguration(arcadiaBaseURL: url, dataMode: mode, fixtureScenario: scenario)
  }

  func albumService() -> AlbumService {
    #if DEBUG
      if dataMode == .fixtures { return FixtureAlbumClient(scenario: fixtureScenario) }
    #endif
    return AlbumClient(api: ArcadiaAPI(baseURL: arcadiaBaseURL))
  }
}

enum ConfigurationError: LocalizedError {
  case missingArcadiaBaseURL
  case invalidArcadiaBaseURL
  case invalidDataMode
  case invalidFixtureScenario
  case fixturesRequireDebug

  var errorDescription: String? {
    switch self {
    case .missingArcadiaBaseURL:
      "ARCADIA_BASE_URL is required."

    case .invalidArcadiaBaseURL:
      "ARCADIA_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment."
    case .invalidDataMode:
      "ARCADIA_DATA_MODE must be fixtures, integration, or live-readonly."
    case .invalidFixtureScenario:
      "ARCADIA_FIXTURE_SCENARIO must be success, empty, failure, failure-then-success, or two-page."
    case .fixturesRequireDebug:
      "Fixtures are available only in development builds."
    }
  }
}
