#import <XCTest/XCTest.h>
@interface ReplayNativeAcceptance : XCTestCase
@end
@implementation ReplayNativeAcceptance
- (XCUIApplication *)library {
  self.continueAfterFailure = NO;
  XCUIApplication *app = [[XCUIApplication alloc] initWithBundleIdentifier:NSProcessInfo.processInfo.environment[@"QA_BUNDLE_ID"]];
  [app launch];
  if ([app.buttons[@"Close field manual"] waitForExistenceWithTimeout:3]) [app.buttons[@"Close field manual"] tap];
  XCTAssertTrue([app.buttons[@"Open shared replay"] waitForExistenceWithTimeout:20]);
  XCTAssertFalse(app.buttons[@"Resume multiplayer operation"].exists);
  XCUIElement *link = app.buttons[@"Open shared replay"];
  for (int i=0; i<3 && !link.hittable; i++) [app swipeUp];
  [link tap];
  XCTAssertTrue([app.buttons[@"Open replay"] waitForExistenceWithTimeout:10]);
  return app;
}
- (XCUIElement *)element:(NSString *)label app:(XCUIApplication *)app {
  return [[app descendantsMatchingType:XCUIElementTypeAny] matchingPredicate:[NSPredicate predicateWithFormat:@"label == %@", label]].firstMatch;
}
- (void)choose:(NSString *)name app:(XCUIApplication *)app {
  [app.buttons[@"Open replay"] tap];
  XCUIElement *file = [[app descendantsMatchingType:XCUIElementTypeAny] matchingPredicate:[NSPredicate predicateWithFormat:@"label BEGINSWITH %@", name]].firstMatch;
  if (![file waitForExistenceWithTimeout:2]) {
    XCTAssertTrue([app.buttons[@"Browse"] waitForExistenceWithTimeout:15]); [app.buttons[@"Browse"] tap];
    if (![file waitForExistenceWithTimeout:2]) {
      XCUIElement *local = [self element:@"On My iPhone" app:app];
      XCTAssertTrue([local waitForExistenceWithTimeout:15]); [local tap];
      XCUIElement *folder = [self element:NSProcessInfo.processInfo.environment[@"QA_DOCUMENTS_NAME"] app:app];
      XCTAssertTrue([folder waitForExistenceWithTimeout:15]); [folder tap];
    }
  }
  XCTAssertTrue([file waitForExistenceWithTimeout:15]); [file tap];
}
- (void)shot:(NSString *)name app:(XCUIApplication *)app {
  XCTAttachment *shot = [XCTAttachment attachmentWithScreenshot:[app screenshot]];
  shot.name = name; shot.lifetime = XCTAttachmentLifetimeKeepAlways; [self addAttachment:shot];
}
- (void)hour:(NSString *)hour app:(XCUIApplication *)app {
  [app.buttons[@"Playback options"] tap];
  XCUIElement *input = app.textFields[@"Replay hour"];
  XCTAssertTrue([input waitForExistenceWithTimeout:10]); XCTAssertEqualObjects(input.value, hour);
  [app.buttons[@"Close playback options"] tap];
}
- (void)testPackedReplayRecovery {
  XCUIApplication *app = [self library]; NSTimeInterval start = [NSDate timeIntervalSinceReferenceDate];
  [self choose:@"01-packed-endgame" app:app];
  XCTAssertTrue([app.buttons[@"Exit replay"] waitForExistenceWithTimeout:30]);
  NSLog(@"QA_PACKED_PICKER_TO_VIEWER_SECONDS %.3f", [NSDate timeIntervalSinceReferenceDate]-start);
  XCTAssertTrue(app.staticTexts[@"Winner · Prism"].firstMatch.exists);
  [self hour:@"402.5673841421317" app:app];
  [app.buttons[@"Beginning"] tap]; XCTAssertFalse(app.staticTexts[@"Winner · Prism"].firstMatch.exists);
  [self hour:@"394.5673841421317" app:app];
  XCTAssertFalse(app.buttons[@"Previous state"].enabled);
  [app.buttons[@"Next state"] tap]; XCTAssertTrue(app.buttons[@"Previous state"].enabled);
  [self hour:@"396" app:app];
  XCUIElement *firstState = [app.staticTexts matchingPredicate:[NSPredicate predicateWithFormat:@"label ENDSWITH %@", @"State 1 of 2"]].firstMatch;
  XCTAssertTrue(firstState.exists);
  [app.buttons[@"Next state"] tap]; [self hour:@"396" app:app];
  XCUIElement *secondState = [app.staticTexts matchingPredicate:[NSPredicate predicateWithFormat:@"label ENDSWITH %@", @"State 2 of 2"]].firstMatch;
  XCTAssertTrue(secondState.exists);
  [app.buttons[@"Previous state"] tap]; XCTAssertTrue(firstState.exists);
  [app.buttons[@"Beginning"] tap]; [app.buttons[@"Play"] tap];
  XCTAssertTrue([app.buttons[@"Pause"] waitForExistenceWithTimeout:3]); [app.buttons[@"Pause"] tap];
  XCTAssertTrue(app.buttons[@"Play"].exists);
  [app.buttons[@"Playback options"] tap];
  NSString *paused = app.textFields[@"Replay hour"].value;
  XCTAssertGreaterThan(paused.doubleValue, 394.5673841421317); XCTAssertLessThan(paused.doubleValue, 402.5673841421317);
  [app.buttons[@"Close playback options"] tap]; [app.buttons[@"Playback options"] tap];
  XCTAssertEqualObjects(app.textFields[@"Replay hour"].value, paused);
  [app.buttons[@"Close playback options"] tap];
  [app.buttons[@"End"] tap]; XCTAssertTrue(app.staticTexts[@"Winner · Prism"].firstMatch.exists);
  [self shot:@"Packed end and transport" app:app];
  [app.buttons[@"Exit replay"] tap]; [app.buttons[@"Open replay"] tap];
  XCUIElement *pickerBar = app.navigationBars[@"FullDocumentManagerViewControllerNavigationBar"];
  XCTAssertTrue([pickerBar waitForExistenceWithTimeout:15]);
  [[pickerBar coordinateWithNormalizedOffset:CGVectorMake(0.5,0)] pressForDuration:0.1 thenDragToCoordinate:[app coordinateWithNormalizedOffset:CGVectorMake(0.5,0.95)]];
  XCTNSPredicateExpectation *dismissed = [[XCTNSPredicateExpectation alloc] initWithPredicate:[NSPredicate predicateWithFormat:@"exists == NO"] object:pickerBar];
  XCTAssertEqual([XCTWaiter waitForExpectations:@[dismissed] timeout:10], XCTWaiterResultCompleted);
  XCTNSPredicateExpectation *ready = [[XCTNSPredicateExpectation alloc] initWithPredicate:[NSPredicate predicateWithFormat:@"enabled == YES"] object:app.buttons[@"Open replay"]];
  XCTWaiterResult readyResult = [XCTWaiter waitForExpectations:@[ready] timeout:10];
  [self shot:@"Cancellation readiness after waiting" app:app];
  XCTAssertEqual(readyResult, XCTWaiterResultCompleted);
  XCTAssertTrue(app.buttons[@"View imported replay"].exists);
  [self choose:@"03-malformed" app:app];
  XCTAssertTrue([app.staticTexts[@"This file is not a supported shared replay."].firstMatch waitForExistenceWithTimeout:10]);
  XCTAssertTrue(app.buttons[@"Open replay"].enabled); XCTAssertTrue(app.buttons[@"View imported replay"].exists);
  [self shot:@"Malformed import retains packed replay" app:app];
  [app.buttons[@"View imported replay"] tap]; XCTAssertTrue([app.buttons[@"Exit replay"] waitForExistenceWithTimeout:10]);
  XCTAssertTrue(app.staticTexts[@"Winner · Prism"].firstMatch.exists); [self hour:@"402.5673841421317" app:app];
}
- (void)testLegacyReplayControls {
  XCUIApplication *app = [self library]; [self choose:@"02-legacy-fixed" app:app];
  XCTAssertTrue([app.buttons[@"Exit replay"] waitForExistenceWithTimeout:30]);
  XCTAssertFalse(app.staticTexts[@"Winner · Prism"].firstMatch.exists); [self hour:@"2" app:app];
  [app.buttons[@"Beginning"] tap]; [self hour:@"0" app:app];
  [app.buttons[@"Playback options"] tap]; XCUIElement *input = app.textFields[@"Replay hour"]; [input tap];
  [input typeText:XCUIKeyboardKeyDelete]; [input typeText:@"0.5"]; [app.buttons[@"Seek hour"] tap];
  XCTAssertEqualObjects(input.value, @"0.5"); [app.buttons[@"Close playback options"] tap];
  XCUIElement *timeline = [self element:@"Replay timeline" app:app]; XCTAssertTrue(timeline.exists);
  [[timeline coordinateWithNormalizedOffset:CGVectorMake(0.5,0.5)] tap];
  [app.buttons[@"Playback options"] tap]; XCTAssertEqualWithAccuracy([app.textFields[@"Replay hour"].value doubleValue],1,0.03);
  [app.buttons[@"Close playback options"] tap];
  XCUIElement *site = [app.buttons matchingPredicate:[NSPredicate predicateWithFormat:@"identifier == %@ AND label BEGINSWITH %@", @"map-site", @"Mnemosyne,"]].firstMatch;
  XCTAssertTrue([site waitForExistenceWithTimeout:10]); XCTAssertTrue(site.hittable); [site tap];
  XCTAssertTrue([app.buttons[@"Close site details"] waitForExistenceWithTimeout:10]);
  XCTAssertTrue(app.staticTexts[@"0 drones"].firstMatch.exists); [self shot:@"Legacy recorded site inspection" app:app];
  [app.buttons[@"Close site details"] tap]; [app.buttons[@"End"] tap]; [self hour:@"2" app:app];
}
- (void)testDriftingLegacyReplay {
  XCUIApplication *app = [self library]; [self choose:@"04-legacy-drift" app:app];
  XCTAssertTrue([app.buttons[@"Exit replay"] waitForExistenceWithTimeout:30]);
  [self hour:@"2" app:app];
  XCUIElement *drifting = [app.buttons matchingPredicate:[NSPredicate predicateWithFormat:@"label CONTAINS %@", @"drifting asteroid base"]].firstMatch;
  XCTAssertTrue(drifting.exists);
  [app.buttons[@"Beginning"] tap]; [self hour:@"0" app:app];
  [app.buttons[@"Next state"] tap]; XCTAssertTrue(app.buttons[@"Previous state"].enabled);
  [app.buttons[@"End"] tap]; [self hour:@"2" app:app];
  [self shot:@"Schema2 drifting replay" app:app];
}
@end
