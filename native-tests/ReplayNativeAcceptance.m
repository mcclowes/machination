#import <XCTest/XCTest.h>
#import <UIKit/UIKit.h>
@interface ReplayNativeAcceptance : XCTestCase
@end
@implementation ReplayNativeAcceptance
- (XCUIApplication *)library {
  self.continueAfterFailure = NO;
  BOOL landscape = [NSProcessInfo.processInfo.environment[@"QA_ORIENTATION"] isEqualToString:@"landscape"];
  [XCUIDevice sharedDevice].orientation = landscape ? UIDeviceOrientationLandscapeLeft : UIDeviceOrientationPortrait;
  XCUIApplication *app = [[XCUIApplication alloc] initWithBundleIdentifier:NSProcessInfo.processInfo.environment[@"QA_BUNDLE_ID"]];
  [app launch];
  NSPredicate *orientation = [NSPredicate predicateWithBlock:^BOOL(id target, NSDictionary *bindings) {
    CGSize size = ((XCUIApplication *)target).frame.size;
    return landscape ? size.width > size.height : size.height > size.width;
  }];
  XCTNSPredicateExpectation *rotated = [[XCTNSPredicateExpectation alloc] initWithPredicate:orientation object:app];
  XCTAssertEqual([XCTWaiter waitForExpectations:@[rotated] timeout:10], XCTWaiterResultCompleted);
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
    XCUIElement *local = [[app descendantsMatchingType:XCUIElementTypeAny] matchingPredicate:[NSPredicate predicateWithFormat:@"label IN %@", @[@"On My iPhone", @"On My iPad"]]].firstMatch;
    NSPredicate *navigationReady = [NSPredicate predicateWithBlock:^BOOL(id target, NSDictionary *bindings) {
      return local.exists || app.buttons[@"Browse"].exists || file.exists;
    }];
    XCTNSPredicateExpectation *navigation = [[XCTNSPredicateExpectation alloc] initWithPredicate:navigationReady object:app];
    XCTAssertEqual([XCTWaiter waitForExpectations:@[navigation] timeout:15], XCTWaiterResultCompleted);
    if (!file.exists && !local.exists) {
      XCTAssertTrue([app.buttons[@"Browse"] waitForExistenceWithTimeout:15]); [app.buttons[@"Browse"] tap];
    }
    if (![file waitForExistenceWithTimeout:2]) {
      XCTAssertTrue([local waitForExistenceWithTimeout:15]); [local tap];
      XCUIElement *folder = [self element:NSProcessInfo.processInfo.environment[@"QA_DOCUMENTS_NAME"] app:app];
      XCTAssertTrue([folder waitForExistenceWithTimeout:15]); [folder tap];
    }
  }
  XCTAssertTrue([file waitForExistenceWithTimeout:15]); [file tap];
}
- (void)shot:(NSString *)name app:(XCUIApplication *)app {
  XCTAssertTrue(app.exists);
  XCTAttachment *shot = [XCTAttachment attachmentWithScreenshot:[[XCUIScreen mainScreen] screenshot]];
  shot.name = name; shot.lifetime = XCTAttachmentLifetimeKeepAlways; [self addAttachment:shot];
}
- (void)hour:(NSString *)hour app:(XCUIApplication *)app {
  [app.buttons[@"Playback options"] tap];
  XCUIElement *input = app.textFields[@"Replay hour"];
  XCTAssertTrue([input waitForExistenceWithTimeout:10]); XCTAssertEqualObjects(input.value, hour);
  [app.buttons[@"Close playback options"] tap];
}
- (XCUIElement *)visibleNumericKeyboard:(XCUIApplication *)app {
  __block XCUIElement *keyboard;
  NSPredicate *keyboardVisible = [NSPredicate predicateWithBlock:^BOOL(id target, NSDictionary *bindings) {
    NSArray<XCUIElement *> *surfaces = [app.popovers.allElementsBoundByIndex arrayByAddingObjectsFromArray:app.keyboards.allElementsBoundByIndex];
    for (XCUIElement *surface in surfaces) {
      XCUIElement *zero = surface.keys[@"0"];
      if (zero.exists && zero.hittable && CGRectContainsRect(app.frame, zero.frame)) { keyboard = surface; return YES; }
    }
    return NO;
  }];
  XCTNSPredicateExpectation *visibleKeyboard = [[XCTNSPredicateExpectation alloc] initWithPredicate:keyboardVisible object:app];
  XCTAssertEqual([XCTWaiter waitForExpectations:@[visibleKeyboard] timeout:10], XCTWaiterResultCompleted);
  return keyboard;
}
- (void)seekHalfHour:(XCUIApplication *)app requireDocked:(BOOL)requireDocked {
  XCUIElement *input = app.textFields[@"Replay hour"];
  XCTAssertTrue(app.buttons[@"Close playback options"].hittable);
  [input tap];
  XCUIElement *keyboard = [self visibleNumericKeyboard:app];
  if (requireDocked && keyboard.elementType == XCUIElementTypePopover) {
    [input typeText:XCUIKeyboardKeyDelete];
    [self shot:@"Docked keyboard setup after erase" app:app];
    keyboard = [self visibleNumericKeyboard:app];
  }
  BOOL docked = keyboard.elementType == XCUIElementTypeKeyboard && keyboard.frame.size.width >= app.frame.size.width;
  NSLog(@"QA_SOFTWARE_KEYBOARD_DOCKED %d FRAME %@", docked, NSStringFromCGRect(keyboard.frame));
  [self shot:docked ? @"Docked software keyboard" : @"Floating software keypad" app:app];
  XCTAssertTrue(!requireDocked || docked, @"The constrained-height case must use a docked software keyboard.");
  if (docked) {
    NSPredicate *formVisible = [NSPredicate predicateWithBlock:^BOOL(id target, NSDictionary *bindings) {
      XCUIElement *seek = app.buttons[@"Seek hour"], *close = app.buttons[@"Close playback options"];
      return input.hittable && seek.hittable && close.hittable &&
        CGRectContainsRect(app.frame, input.frame) && CGRectContainsRect(app.frame, seek.frame) && CGRectContainsRect(app.frame, close.frame);
    }];
    XCTNSPredicateExpectation *form = [[XCTNSPredicateExpectation alloc] initWithPredicate:formVisible object:app];
    XCTAssertEqual([XCTWaiter waitForExpectations:@[form] timeout:10], XCTWaiterResultCompleted);
  }
  XCUIElement *remove = [keyboard.keys matchingPredicate:[NSPredicate predicateWithFormat:@"label ==[c] %@ OR identifier ==[c] %@", @"delete", @"delete"]].firstMatch;
  [remove tap]; [keyboard.keys[@"0"] tap]; [keyboard.keys[@"."] tap]; [keyboard.keys[@"5"] tap];
  XCTAssertTrue(keyboard.keys[@"0"].hittable);
  [self shot:@"Exact hour entry with software keys" app:app];
  if (!docked) {
    XCUIElement *dismiss = app.otherElements[@"PopoverDismissRegion"];
    XCTAssertTrue(dismiss.hittable); [dismiss tap];
    XCTNSPredicateExpectation *hidden = [[XCTNSPredicateExpectation alloc] initWithPredicate:[NSPredicate predicateWithFormat:@"exists == NO"] object:keyboard];
    XCTAssertEqual([XCTWaiter waitForExpectations:@[hidden] timeout:10], XCTWaiterResultCompleted);
  }
  XCTAssertEqualObjects(input.value, @"0.5");
  [app.buttons[@"Seek hour"] tap];
  XCTAssertTrue([app.staticTexts[@"D01 · 00:30"].firstMatch waitForExistenceWithTimeout:10]);
  XCTAssertTrue(app.buttons[@"Close playback options"].hittable);
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
  XCUIElement *cancel = app.navigationBars.buttons[@"Cancel"].firstMatch;
  if (cancel.exists && cancel.hittable) [cancel tap];
  else [[pickerBar coordinateWithNormalizedOffset:CGVectorMake(0.5,0)] pressForDuration:0.1 thenDragToCoordinate:[app coordinateWithNormalizedOffset:CGVectorMake(0.5,0.95)]];
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
  [app.buttons[@"Playback options"] tap];
  BOOL pad = [UIDevice currentDevice].userInterfaceIdiom == UIUserInterfaceIdiomPad;
  [self seekHalfHour:app requireDocked:!pad];
  if (pad) { [app.buttons[@"Beginning"] tap]; [self seekHalfHour:app requireDocked:YES]; }
  [app.buttons[@"Close playback options"] tap];
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
