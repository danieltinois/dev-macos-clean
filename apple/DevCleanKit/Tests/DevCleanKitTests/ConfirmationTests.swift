// The Mac's cleanup confirmation.
import Foundation
import Testing
@testable import DevCleanKit

@Suite struct ConfirmationTests {
  @Test func confirmationListsReviewItemsApart() {
    var safe = Finding(ruleId: "npm-cache", category: "node", severity: .safe, path: "/h/.npm/_cacache", sizeBytes: 3 * 1024 * 1024 / 2)
    safe.cleanupReview = false
    var review = Finding(ruleId: "user-logs", category: "logs", severity: .review, path: "/h/Library/Logs/x", sizeBytes: 1024 * 1024)
    review.cleanupReview = true
    let confirmation = Confirmation([safe, review], automatic: false)
    #expect(confirmation.message == "Mover 2 item(ns) para a Lixeira?")
    #expect(confirmation.detail.hasPrefix("2,5 MB selecionados.\n\n/h/.npm/_cacache\n\n⚠️ PARA REVISAR"))
    #expect(confirmation.detail.contains("/h/Library/Logs/x\n\nFeche builds"))
    #expect(Confirmation([safe], automatic: true).message == "Limpeza automática: mover 1 cache(s) e dependência(s) para a Lixeira?")
  }

}
