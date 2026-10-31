//
//  DesignTokens.swift
//  Arcadia
//
//  Created by Joshua O'Brien on 22/8/2026.
//

import SwiftUI

enum DesignTokens {
  #if os(macOS)
    enum Desktop {
      static let accent = Color(red: 0.04, green: 0.52, blue: 0.49)
    }
  #endif

  enum Spacing {
    static let none: CGFloat = 0
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 24
  }

  enum Radius {
    static let s: CGFloat = 4
    static let m: CGFloat = 8
    static let l: CGFloat = 12
  }
}
