//
//  AppConfiguration.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 16/8/2026.
//
import Foundation

struct AppConfiguration {
  let arcadiaBaseURL: URL

  static func load(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws -> AppConfiguration {
    guard let value = environment["ARCADIA_BASE_URL"], !value.isEmpty
    else {
      throw ConfigurationError.missingArcadiaBaseURL
    }

    guard let url = URL(string: value) else {
      throw ConfigurationError.invalidArcadiaBaseURL(value)
    }

    return AppConfiguration(arcadiaBaseURL: url)
  }
}

enum ConfigurationError: LocalizedError {
  case missingArcadiaBaseURL
  case invalidArcadiaBaseURL(String)

  var errorDescription: String? {
    switch self {
    case .missingArcadiaBaseURL:
      "ARCADIA_BASE_URL is required."

    case .invalidArcadiaBaseURL(let value):
      "ARCADIA_BASE_URL is invalid: \(value)"
    }
  }
}
