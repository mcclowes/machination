#import <XCTest/XCTest.h>
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>
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
  XCUIElement *knownFile = [app.cells matchingPredicate:[NSPredicate predicateWithFormat:@"label MATCHES %@", @"0[1-4]-.*"]].firstMatch;
  if (![file waitForExistenceWithTimeout:2] && !knownFile.exists) {
    XCUIElement *local = [[app descendantsMatchingType:XCUIElementTypeAny] matchingPredicate:[NSPredicate predicateWithFormat:@"label IN %@", @[@"On My iPhone", @"On My iPad"]]].firstMatch;
    NSPredicate *navigationReady = [NSPredicate predicateWithBlock:^BOOL(id target, NSDictionary *bindings) {
      return local.exists || app.buttons[@"Browse"].exists || file.exists || knownFile.exists;
    }];
    XCTNSPredicateExpectation *navigation = [[XCTNSPredicateExpectation alloc] initWithPredicate:navigationReady object:app];
    XCTAssertEqual([XCTWaiter waitForExpectations:@[navigation] timeout:15], XCTWaiterResultCompleted);
    if (!file.exists && !knownFile.exists && !local.exists) {
      XCTAssertTrue([app.buttons[@"Browse"] waitForExistenceWithTimeout:15]); [app.buttons[@"Browse"] tap];
    }
    if (![file waitForExistenceWithTimeout:2] && !knownFile.exists) {
      XCTAssertTrue([local waitForExistenceWithTimeout:15]); [local tap];
      XCUIElement *folder = [self element:NSProcessInfo.processInfo.environment[@"QA_DOCUMENTS_NAME"] app:app];
      XCTAssertTrue([folder waitForExistenceWithTimeout:15]); [folder tap];
    }
  }
  XCUIElement *grid = app.collectionViews[@"File View"];
  XCTAssertTrue([grid waitForExistenceWithTimeout:15]);
  for (int i=0; i<3 && (!file.exists || CGRectGetMinY(file.frame) < CGRectGetMinY(grid.frame)); i++) [grid swipeDown];
  XCUIElement *thumbnail = file.images.firstMatch;
  for (int i=0; i<5 && (!thumbnail.exists || !file.hittable || !CGRectContainsRect(grid.frame, thumbnail.frame)); i++) {
    [grid swipeUp];
  }
  __block CGRect previousFrame = CGRectNull;
  __block NSTimeInterval unchangedSince = 0;
  NSPredicate *settled = [NSPredicate predicateWithBlock:^BOOL(id target, NSDictionary *bindings) {
    if (!thumbnail.exists || !file.hittable) return NO;
    CGRect frame = thumbnail.frame;
    NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
    if (!CGRectEqualToRect(frame, previousFrame)) { previousFrame = frame; unchangedSince = now; }
    return CGRectContainsRect(grid.frame, frame) && now - unchangedSince >= 0.5;
  }];
  XCTNSPredicateExpectation *stableFile = [[XCTNSPredicateExpectation alloc] initWithPredicate:settled object:thumbnail];
  XCTAssertEqual([XCTWaiter waitForExpectations:@[stableFile] timeout:10], XCTWaiterResultCompleted);
  // The thumbnail is decorative; its visible center lies inside the interactive file cell.
  [[thumbnail coordinateWithNormalizedOffset:CGVectorMake(0.5,0.5)] tap];
}
- (void)shot:(NSString *)name app:(XCUIApplication *)app {
  XCTAssertTrue(app.exists);
  XCTAttachment *shot = [XCTAttachment attachmentWithScreenshot:[[XCUIScreen mainScreen] screenshot]];
  shot.name = name; shot.lifetime = XCTAttachmentLifetimeKeepAlways; [self addAttachment:shot];
}
- (void)waitForStable:(XCUIElement *)element app:(XCUIApplication *)app {
  [self waitForStable:element app:app tolerance:0];
}
- (void)waitForStable:(XCUIElement *)element app:(XCUIApplication *)app tolerance:(CGFloat)tolerance {
  XCTAssertTrue([element waitForExistenceWithTimeout:10]);
  CGRect bounds = CGRectInset(app.frame,-tolerance,-tolerance);
  __block CGRect previousFrame = CGRectNull;
  __block NSTimeInterval unchangedSince = 0;
  NSPredicate *settled = [NSPredicate predicateWithBlock:^BOOL(id target, NSDictionary *bindings) {
    CGRect frame = element.frame;
    NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
    if (!CGRectEqualToRect(frame, previousFrame)) { previousFrame = frame; unchangedSince = now; }
    return CGRectContainsRect(bounds, frame) && now - unchangedSince >= 0.5;
  }];
  XCTNSPredicateExpectation *ready = [[XCTNSPredicateExpectation alloc] initWithPredicate:settled object:element];
  XCTWaiterResult result = [XCTWaiter waitForExpectations:@[ready] timeout:10];
  BOOL hittable = result == XCTWaiterResultCompleted && element.hittable;
  if (!hittable) {
    [self shot:@"Native control readiness" app:app];
    XCTAttachment *state = [XCTAttachment attachmentWithString:[NSString stringWithFormat:@"App bounds %@\n%@", NSStringFromCGRect(bounds), element.debugDescription]];
    state.name = @"Replay control readiness"; state.lifetime = XCTAttachmentLifetimeKeepAlways; [self addAttachment:state];
  }
  XCTAssertEqual(result, XCTWaiterResultCompleted); XCTAssertTrue(hittable);
}
- (void)closeOptions:(XCUIApplication *)app {
  XCUIElement *close = app.buttons[@"Close playback options"];
  [self waitForStable:close app:app]; [close tap];
  XCTNSPredicateExpectation *closed = [[XCTNSPredicateExpectation alloc] initWithPredicate:[NSPredicate predicateWithFormat:@"exists == NO"] object:close];
  XCTAssertEqual([XCTWaiter waitForExpectations:@[closed] timeout:10], XCTWaiterResultCompleted);
  [self waitForStable:app.buttons[@"Playback options"] app:app];
}
- (void)reveal:(XCUIElement *)element inScrollView:(XCUIElement *)scroll app:(XCUIApplication *)app {
  XCTAssertTrue([element waitForExistenceWithTimeout:10]);
  for (int i=0; i<6; i++) {
    [self waitForStable:scroll app:app];
    CGRect visible = CGRectIntersection(scroll.frame,app.frame);
    if (CGRectContainsRect(visible,element.frame)) return;
    CGFloat delta = CGRectGetMinY(element.frame) < CGRectGetMinY(visible)
      ? MIN(visible.size.height*0.4,CGRectGetMinY(visible)-CGRectGetMinY(element.frame)+12)
      : -MIN(visible.size.height*0.4,CGRectGetMaxY(element.frame)-CGRectGetMaxY(visible)+12);
    NSLog(@"QA_REVEAL %@ TARGET %@ CLIP %@ DELTA %.1f",element.label,NSStringFromCGRect(element.frame),NSStringFromCGRect(visible),delta);
    XCUICoordinate *from = [scroll coordinateWithNormalizedOffset:CGVectorMake(0.5,0.5)];
    [from pressForDuration:0.05 thenDragToCoordinate:[from coordinateWithOffset:CGVectorMake(0,delta)] withVelocity:200 thenHoldForDuration:0.2];
  }
  [self shot:@"Practice scroll readiness" app:app];
  XCTAssertTrue(CGRectContainsRect(CGRectIntersection(scroll.frame,app.frame),element.frame),@"The control must be visible within its scroller.");
}
- (void)revealNavigationTab:(XCUIElement *)button app:(XCUIApplication *)app {
  XCUIElement *navigation = app.otherElements[@"operation-navigation"].scrollViews.firstMatch;
  CGFloat rounding = 0.5 / UIScreen.mainScreen.scale;
  CGRect bounds = CGRectInset(app.frame,-rounding,-rounding);
  for (int i=0; i<6 && (!button.hittable || !CGRectContainsRect(bounds,button.frame)); i++) {
    XCTAssertTrue([navigation waitForExistenceWithTimeout:10]);
    CGRect visible = CGRectIntersection(navigation.frame,app.frame);
    XCTAssertGreaterThan(visible.size.width,0); XCTAssertGreaterThan(visible.size.height,0);
    NSLog(@"QA_NAVIGATION_VIEWPORT scroll %@ app %@ target %@",NSStringFromCGRect(navigation.frame),NSStringFromCGRect(app.frame),NSStringFromCGRect(button.frame));
    CGFloat delta = CGRectGetMinX(button.frame) < CGRectGetMinX(visible)
      ? MIN(visible.size.width*0.4,CGRectGetMinX(visible)-CGRectGetMinX(button.frame)+12)
      : -MIN(visible.size.width*0.4,CGRectGetMaxX(button.frame)-CGRectGetMaxX(visible)+12);
    XCUICoordinate *from = [[app coordinateWithNormalizedOffset:CGVectorMake(0,0)] coordinateWithOffset:CGVectorMake(CGRectGetMidX(visible)-CGRectGetMinX(app.frame),CGRectGetMidY(visible)-CGRectGetMinY(app.frame))];
    [from pressForDuration:0.05 thenDragToCoordinate:[from coordinateWithOffset:CGVectorMake(delta,0)] withVelocity:200 thenHoldForDuration:0.2];
  }
  [self waitForStable:button app:app tolerance:rounding];
}
- (void)operationNavigation:(XCUIApplication *)app {
  CGFloat controlHeight = app.buttons[@"Resolve orders"].frame.size.height;
  [self shot:@"Operation navigation before selection" app:app];
  for (NSString *label in @[@"Chart",@"Orders",@"Specialists",@"Signals",@"Intel",@"Setup"]) {
    XCUIElement *button = app.buttons[label];
    [self revealNavigationTab:button app:app];
    XCTAssertLessThanOrEqual(button.frame.size.height,controlHeight*2.5,@"The %@ tab must fit its icon and readable label without fragmented wrapping: %@",label,NSStringFromCGRect(button.frame));
    [button tap];
    XCTAssertTrue(button.selected,@"The %@ navigation tab must retain selection semantics.",label);
    [self shot:[NSString stringWithFormat:@"Operation navigation %@",label] app:app];
  }
  XCUIElement *chart = app.buttons[@"Chart"];
  [self revealNavigationTab:chart app:app]; [chart tap];
  [self shot:@"Operation navigation labels and selection" app:app];
}
- (void)destroyedStatus:(XCUIApplication *)app {
  XCUIElementQuery *copies = [app.buttons matchingPredicate:[NSPredicate predicateWithFormat:@"identifier == %@ AND label BEGINSWITH %@", @"map-site", @"Jasper, destroyed site, Mnemosyne,"]];
  XCUIElement *site;
  for (XCUIElement *candidate in copies.allElementsBoundByIndex) {
    if (candidate.hittable && CGRectContainsRect(app.frame, candidate.frame)) { site = candidate; break; }
  }
  XCTAssertNotNil(site); [self waitForStable:site app:app];
  CGRect frame = site.frame;
  UIImage *screen = [[XCUIScreen mainScreen] screenshot].image;
  CGFloat sx = CGImageGetWidth(screen.CGImage) / CGRectGetWidth(app.frame);
  CGFloat sy = CGImageGetHeight(screen.CGImage) / CGRectGetHeight(app.frame);
  CGRect region = CGRectMake((CGRectGetMidX(frame)-6)*sx, (CGRectGetMidY(frame)-6)*sy, 12*sx, 12*sy);
  CGImageRef crop = CGImageCreateWithImageInRect(screen.CGImage, region);
  XCTAssertTrue(crop != NULL);
  XCTAttachment *image = [XCTAttachment attachmentWithImage:[UIImage imageWithCGImage:crop]];
  image.name = @"Destroyed site status crop"; image.lifetime = XCTAttachmentLifetimeKeepAlways; [self addAttachment:image];
  unsigned char pixels[24*24*4] = {0};
  CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(pixels,24,24,8,24*4,color,kCGImageAlphaPremultipliedLast|kCGBitmapByteOrder32Big);
  XCTAssertTrue(context != NULL);
  CGContextDrawImage(context,CGRectMake(0,0,24,24),crop);
  NSUInteger dark = 0, bright = 0;
  for (NSUInteger i=0; i<24*24; i++) {
    unsigned char *pixel = pixels+i*4;
    if (pixel[0]<55 && pixel[1]<55 && pixel[2]<55) dark++;
    if (pixel[1]>90 && pixel[2]>90) bright++;
  }
  CGContextRelease(context); CGColorSpaceRelease(color); CGImageRelease(crop);
  double ink = dark/(24.0*24.0);
  NSLog(@"QA_DESTROYED_STATUS_INK %.5f FRAME %@ LABEL %@",ink,NSStringFromCGRect(frame),site.label);
  XCTAssertGreaterThan(bright/(24.0*24.0),0.5,@"The sampled center must be inside the colored site marker.");
  XCTAssertGreaterThan(ink,0.03,@"The destroyed-site cross must remain visible inside its marker.");
}
- (void)statusSample:(XCUIElement *)site name:(NSString *)name app:(XCUIApplication *)app {
  [self waitForStable:site app:app];
  UIImage *screen = [[XCUIScreen mainScreen] screenshot].image;
  CGRect frame = site.frame;
  CGFloat sx = CGImageGetWidth(screen.CGImage) / CGRectGetWidth(app.frame);
  CGFloat sy = CGImageGetHeight(screen.CGImage) / CGRectGetHeight(app.frame);
  CGImageRef crop = CGImageCreateWithImageInRect(screen.CGImage,CGRectMake(frame.origin.x*sx,frame.origin.y*sy,frame.size.width*sx,frame.size.height*sy));
  XCTAssertTrue(crop != NULL);
  XCTAttachment *image = [XCTAttachment attachmentWithImage:[UIImage imageWithCGImage:crop]];
  image.name = name; image.lifetime = XCTAttachmentLifetimeKeepAlways; [self addAttachment:image];
  NSLog(@"QA_MAP_STATUS_SAMPLE %@ LABEL %@ FRAME %@",name,site.label,NSStringFromCGRect(frame));
  CGImageRelease(crop);
}
- (void)hour:(NSString *)hour app:(XCUIApplication *)app {
  [app.buttons[@"Playback options"] tap];
  XCUIElement *input = app.textFields[@"Replay hour"];
  XCTAssertTrue([input waitForExistenceWithTimeout:10]); XCTAssertEqualObjects(input.value, hour);
  [self closeOptions:app];
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
  [self destroyedStatus:app];
  XCUIElement *unknown = nil;
  for (XCUIElement *candidate in [app.buttons matchingPredicate:[NSPredicate predicateWithFormat:@"identifier == %@ AND label CONTAINS %@", @"map-site", @", unknown site,"]].allElementsBoundByIndex) {
    if (CGRectContainsRect(app.frame,candidate.frame) && candidate.hittable) { unknown = candidate; break; }
  }
  XCTAssertNotNil(unknown); [self statusSample:unknown name:@"Unknown site symbol" app:app];
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
  [self closeOptions:app]; [app.buttons[@"Playback options"] tap];
  XCTAssertEqualObjects(app.textFields[@"Replay hour"].value, paused);
  [self closeOptions:app];
  [app.buttons[@"End"] tap]; XCTAssertTrue(app.staticTexts[@"Winner · Prism"].firstMatch.exists);
  [self shot:@"Packed end and transport" app:app];
  [app.buttons[@"Exit replay"] tap]; [app.buttons[@"Open replay"] tap];
  XCUIElement *pickerBar = app.navigationBars[@"FullDocumentManagerViewControllerNavigationBar"];
  XCTAssertTrue([pickerBar waitForExistenceWithTimeout:15]);
  XCUIElement *cancel = app.navigationBars.buttons[@"Cancel"].firstMatch;
  if (cancel.exists && cancel.hittable) [cancel tap];
  else {
    XCUICoordinate *sheetEdge = [[pickerBar coordinateWithNormalizedOffset:CGVectorMake(0.5,0)] coordinateWithOffset:CGVectorMake(0,-8)];
    [sheetEdge pressForDuration:0.1 thenDragToCoordinate:[app coordinateWithNormalizedOffset:CGVectorMake(0.5,0.95)]];
  }
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
  [self closeOptions:app];
  XCUIElement *timeline = [self element:@"Replay timeline" app:app]; XCTAssertTrue(timeline.exists);
  [[timeline coordinateWithNormalizedOffset:CGVectorMake(0.5,0.5)] tap];
  [app.buttons[@"Playback options"] tap]; XCTAssertEqualWithAccuracy([app.textFields[@"Replay hour"].value doubleValue],1,0.03);
  [self closeOptions:app];
  XCUIElement *site = [app.buttons matchingPredicate:[NSPredicate predicateWithFormat:@"identifier == %@ AND label BEGINSWITH %@", @"map-site", @"Mnemosyne,"]].firstMatch;
  XCTAssertTrue([site waitForExistenceWithTimeout:10]); XCTAssertTrue(site.hittable);
  [self statusSample:site name:@"Intelligence core symbol" app:app]; [site tap];
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
- (void)testFirstReinforcement {
  self.continueAfterFailure = NO;
  [XCUIDevice sharedDevice].orientation = UIDeviceOrientationPortrait;
  XCUIApplication *app = [[XCUIApplication alloc] initWithBundleIdentifier:NSProcessInfo.processInfo.environment[@"QA_BUNDLE_ID"]];
  [app launch];
  XCTAssertGreaterThan(app.frame.size.height,app.frame.size.width);
  if ([app.buttons[@"Close field manual"] waitForExistenceWithTimeout:5]) [app.buttons[@"Close field manual"] tap];
  XCTAssertFalse(app.buttons[@"Resume multiplayer operation"].exists);
  XCUIElement *practice = app.buttons[@"Start tactical practice"];
  XCTAssertTrue([practice waitForExistenceWithTimeout:20]);
  for (int i=0; i<4 && !practice.hittable; i++) [app swipeUp];
  [self waitForStable:practice app:app]; [practice tap];
  XCUIElement *start = app.buttons[@"Start: Open a foothold"];
  [self reveal:start inScrollView:app.scrollViews.firstMatch app:app];
  [self waitForStable:start app:app]; [start tap];
  XCTAssertTrue([app.staticTexts[@"Mission briefing"] waitForExistenceWithTimeout:10]);
  [self shot:@"First exercise briefing" app:app];
  XCUIElement *briefing = [app.staticTexts matchingPredicate:[NSPredicate predicateWithFormat:@"label BEGINSWITH %@", @"Welcome to the quiet belt, Captain."]].firstMatch;
  XCTAssertTrue([briefing waitForExistenceWithTimeout:10]);
  XCUIElement *briefingScroll = [app.scrollViews containingPredicate:[NSPredicate predicateWithFormat:@"label BEGINSWITH %@", @"Welcome to the quiet belt, Captain."]].firstMatch;
  [self waitForStable:briefingScroll app:app];
  for (int i=0; i<4 && CGRectGetMaxY(briefing.frame) > CGRectGetMaxY(briefingScroll.frame); i++) [briefingScroll swipeUp];
  XCTAssertLessThanOrEqual(CGRectGetMaxY(briefing.frame),CGRectGetMaxY(briefingScroll.frame));
  XCTAssertGreaterThan(CGRectGetMaxY(briefing.frame),CGRectGetMinY(briefingScroll.frame));
  [self waitForStable:app.buttons[@"Continue dialogue"] app:app];
  [self shot:@"Briefing end and visible actions" app:app];
  for (int i=0; i<8 && app.buttons[@"Continue dialogue"].exists; i++) [app.buttons[@"Continue dialogue"] tap];
  [self waitForStable:app.buttons[@"Take command"] app:app]; [app.buttons[@"Take command"] tap];
  [self operationNavigation:app];
  XCUIElement *foundry = [app.buttons matchingPredicate:[NSPredicate predicateWithFormat:@"identifier == %@ AND label BEGINSWITH %@", @"map-site", @"Foundry,"]].firstMatch;
  [self waitForStable:foundry app:app]; [foundry tap];
  XCUIElement *drones = app.textFields[@"Drones to dispatch"];
  [self waitForStable:drones app:app]; [drones tap];
  NSString *previous = (NSString *)drones.value;
  for (NSUInteger i=0; i<previous.length; i++) [drones typeText:XCUIKeyboardKeyDelete];
  XCUIElement *keyboard = [self visibleNumericKeyboard:app];
  XCUIElement *manifestScroll = app.otherElements[@"operation-drawer"].scrollViews.firstMatch;
  [self waitForStable:manifestScroll app:app];
  [self shot:@"Manifest viewport with keypad" app:app];
  for (NSString *label in @[@"Chart",@"Orders"]) {
    XCUIElement *button = app.buttons[label];
    XCTAssertTrue(CGRectContainsRect(app.frame,button.frame));
    XCTAssertLessThanOrEqual(button.frame.size.height,app.buttons[@"Resolve orders"].frame.size.height*2.5);
    XCTAssertLessThanOrEqual(CGRectGetMaxY(button.frame),CGRectGetMinY(keyboard.frame));
  }
  XCTAssertTrue(CGRectContainsRect(manifestScroll.frame,drones.frame),@"The exact cargo field %@ must be fully visible within %@ while the keypad %@ is open.",NSStringFromCGRect(drones.frame),NSStringFromCGRect(manifestScroll.frame),NSStringFromCGRect(keyboard.frame));
  XCTAssertTrue(keyboard.keys[@"6"].hittable); [keyboard.keys[@"6"] tap];
  XCTAssertEqualObjects(drones.value,@"6");
  [self shot:@"First reinforcement manifest" app:app];
  XCUIElement *plan = app.buttons[@"Plan transfer ↗"];
  XCUIElement *drawerScroll = app.otherElements[@"operation-drawer"].scrollViews.firstMatch;
  for (int i=0; i<6 && !plan.hittable; i++) {
    [self waitForStable:drawerScroll app:app];
    if (CGRectGetMinY(plan.frame) < CGRectGetMinY(drawerScroll.frame)) [drawerScroll swipeDown];
    else [drawerScroll swipeUp];
    [self waitForStable:drawerScroll app:app];
  }
  [self shot:@"First reinforcement action after scrolling" app:app];
  XCTAssertEqualObjects(drones.value,@"6",@"Scrolling the drawer must preserve the exact drone manifest.");
  [self waitForStable:plan app:app]; [plan tap];
  XCUIElement *landing = [app.buttons matchingPredicate:[NSPredicate predicateWithFormat:@"identifier == %@ AND label BEGINSWITH %@", @"map-site", @"Quiet landing,"]].firstMatch;
  [self waitForStable:landing app:app]; [landing tap];
  XCUIElement *prepare = app.buttons[@"Prepare launch · 10m"];
  if (!prepare.hittable || !CGRectContainsRect(app.frame,prepare.frame)) {
    [self reveal:prepare inScrollView:app.otherElements[@"operation-drawer"].scrollViews.firstMatch app:app];
  }
  [self waitForStable:prepare app:app]; [prepare tap];
  XCUIElement *hauler = [app.buttons matchingPredicate:[NSPredicate predicateWithFormat:@"label CONTAINS %@", @"hauler, preparing launch, 6 drones"]].firstMatch;
  XCTAssertTrue([hauler waitForExistenceWithTimeout:10]);
  [self shot:@"First reinforcement prepared" app:app];
  XCUIElement *resolve = app.buttons[@"Resolve orders"];
  [self waitForStable:resolve app:app]; XCTAssertTrue(resolve.enabled); [resolve tap];
  XCTAssertTrue([app.staticTexts[@"Mission complete"] waitForExistenceWithTimeout:60]);
  [self shot:@"First exercise complete" app:app];
  for (int i=0; i<8 && app.buttons[@"Continue dialogue"].exists; i++) [app.buttons[@"Continue dialogue"] tap];
  [self waitForStable:app.buttons[@"Return to chart"] app:app]; [app.buttons[@"Return to chart"] tap];
  XCTAssertTrue(app.staticTexts[@"Exercise complete"].exists);
  XCTAssertTrue([landing.label containsString:@"Mnemosyne, 2 drones"],@"The six-drone order must capture the four-drone garrison with two survivors.");
  [app.buttons[@"All exercises"] tap];
  XCTAssertTrue([app.staticTexts[@"1. Open a foothold · completed"] waitForExistenceWithTimeout:10]);
  [app terminate]; [app launch];
  practice = app.buttons[@"Start tactical practice"];
  XCTAssertTrue([practice waitForExistenceWithTimeout:20]);
  for (int i=0; i<4 && !practice.hittable; i++) [app swipeUp];
  [self waitForStable:practice app:app]; [practice tap];
  XCTAssertTrue([app.staticTexts[@"1. Open a foothold · completed"] waitForExistenceWithTimeout:10]);
  [self reveal:[app.staticTexts matchingIdentifier:@"1. Open a foothold · completed"].firstMatch inScrollView:app.scrollViews.firstMatch app:app];
  [self shot:@"First exercise progress after relaunch" app:app];
}
- (void)role:(XCUIElement *)element expected:(XCUIElementType)expected stage:(NSString *)stage {
  XCTAssertTrue([element waitForExistenceWithTimeout:20]);
  NSString *report = [NSString stringWithFormat:@"Stage: %@\nLabel: %@\nType: %lu\nExpected: %lu\nValue: %@\n%@",stage,element.label,(unsigned long)element.elementType,(unsigned long)expected,element.value,element.debugDescription];
  NSLog(@"QA_AX_ROLE %@",report);
  XCTAttachment *attachment = [XCTAttachment attachmentWithString:report];
  attachment.name = [NSString stringWithFormat:@"Native AX role %@ %@",stage,element.label];
  attachment.lifetime = XCTAttachmentLifetimeKeepAlways; [self addAttachment:attachment];
  XCTAssertEqual(element.elementType,expected,@"Independent XCTest role must match the declared control role: %@",report);
}
- (void)closeOperationDrawer:(XCUIApplication *)app {
  XCUIElement *close = [app.otherElements[@"operation-drawer"].buttons matchingPredicate:[NSPredicate predicateWithFormat:@"label BEGINSWITH %@",@"Close "]].firstMatch;
  if (close.exists) { [self waitForStable:close app:app]; [close tap]; }
}
- (void)testSecureEditorTransitions {
  XCUIApplication *app = [self library];
  [app.buttons[@"Exit replay library"] tap];
  for (int cycle=0; cycle<2; cycle++) {
    XCUIElement *online = app.buttons[@"Open multiplayer uplink"];
    XCTAssertTrue([online waitForExistenceWithTimeout:20]);
    for (int i=0; i<4 && !online.hittable; i++) [app swipeUp];
    [self waitForStable:online app:app]; [online tap];
    XCUIElement *url = [self element:@"Game server URL" app:app];
    [self role:url expected:XCUIElementTypeTextField stage:@"multiplayer ordinary server editor"];
    XCUIElement *restore = app.buttons[@"Restore a seat"];
    [self waitForStable:restore app:app]; [restore tap];
    XCTAssertFalse(app.buttons[@"Create private operation"].exists);
    XCUIElement *recovery = [self element:@"Recovery code" app:app];
    [self reveal:recovery inScrollView:app.scrollViews.firstMatch app:app];
    [self role:recovery expected:XCUIElementTypeSecureTextField stage:@"recovery before input"];
    [self waitForStable:recovery app:app]; [recovery tap];
    [recovery typeText:@"qa-sample"];
    [self role:recovery expected:XCUIElementTypeSecureTextField stage:@"recovery with synthetic input"];
    NSString *masked = (NSString *)recovery.value;
    XCTAssertTrue(masked.length > 0);
    XCTAssertFalse([masked containsString:@"qa"]);
    XCTAssertFalse([masked containsString:@"sample"]);
    XCTAssertFalse(app.textFields[@"Recovery code"].exists);
    [self shot:[NSString stringWithFormat:@"Secure recovery cycle %d",cycle+1] app:app];
    [self waitForStable:app.buttons[@"‹ Games"] app:app]; [app.buttons[@"‹ Games"] tap];
    XCUIElement *solo = app.buttons[cycle ? @"Resume solo operation" : @"Open solo operation"];
    XCTAssertTrue([solo waitForExistenceWithTimeout:20]);
    for (int i=0; i<4 && !solo.hittable; i++) [app swipeUp];
    [self waitForStable:solo app:app]; [solo tap];
    XCUIElement *site = [[app descendantsMatchingType:XCUIElementTypeAny] matchingPredicate:[NSPredicate predicateWithFormat:@"identifier == %@ AND label CONTAINS %@",@"map-site",@"Mnemosyne,"]].firstMatch;
    [self role:site expected:XCUIElementTypeButton stage:@"solo after secure editor"];
    [self waitForStable:site app:app]; [site tap];
    XCUIElement *cargo = [self element:@"Drones to dispatch" app:app];
    [self role:cargo expected:XCUIElementTypeTextField stage:@"solo cargo after secure editor"];
    XCTAssertFalse(app.secureTextFields[@"Drones to dispatch"].exists);
    [self waitForStable:cargo app:app]; [cargo tap];
    NSString *old = (NSString *)cargo.value;
    for (NSUInteger i=0; i<old.length; i++) [cargo typeText:XCUIKeyboardKeyDelete];
    XCUIElement *keyboard = [self visibleNumericKeyboard:app];
    XCTAssertTrue(keyboard.keys[@"2"].hittable); [keyboard.keys[@"2"] tap];
    XCTAssertEqualObjects(cargo.value,@"2");
    [self shot:[NSString stringWithFormat:@"Ordinary cargo cycle %d",cycle+1] app:app];
    [self closeOperationDrawer:app];
    XCUIElement *setup = app.buttons[@"Setup"];
    [self revealNavigationTab:setup app:app]; [setup tap];
    [self waitForStable:app.buttons[@"‹ Games"] app:app]; [app.buttons[@"‹ Games"] tap];
  }
}

- (void)visibleHeader:(NSString *)title app:(XCUIApplication *)app {
  XCUIElement *heading = [self element:title app:app];
  [self waitForStable:heading app:app];
  XCTAssertLessThanOrEqual(CGRectGetMaxY(heading.frame),CGRectGetMinY(app.scrollViews.firstMatch.frame)+0.5,@"Inspect the shared header, not a matching heading inside the page.");
  XCUIScreenshot *screen = XCUIScreen.mainScreen.screenshot;
  CGFloat scale = CGImageGetWidth(screen.image.CGImage) / app.frame.size.width;
  CGRect frame = CGRectOffset(heading.frame,-app.frame.origin.x,-app.frame.origin.y);
  CGRect pixels = CGRectMake(frame.origin.x*scale,frame.origin.y*scale,frame.size.width*scale,frame.size.height*scale);
  CGImageRef crop = CGImageCreateWithImageInRect(screen.image.CGImage,CGRectIntegral(pixels));
  XCTAssertTrue(crop != NULL);
  if (!crop) return;
  XCTAttachment *image = [XCTAttachment attachmentWithImage:[UIImage imageWithCGImage:crop]];
  image.name = [@"Visible header " stringByAppendingString:title]; image.lifetime = XCTAttachmentLifetimeKeepAlways; [self addAttachment:image];
  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.recognitionLanguages = @[@"en-US"]; request.usesLanguageCorrection = NO;
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:crop options:@{}];
  NSError *error = nil; BOOL read = [handler performRequests:@[request] error:&error]; CGImageRelease(crop);
  XCTAssertTrue(read,@"Read only the visible title crop: %@",error);
  NSArray<VNRecognizedTextObservation *> *lines = [request.results sortedArrayUsingComparator:^NSComparisonResult(VNRecognizedTextObservation *a,VNRecognizedTextObservation *b) {
    if (a.boundingBox.origin.y > b.boundingBox.origin.y) return NSOrderedAscending;
    if (a.boundingBox.origin.y < b.boundingBox.origin.y) return NSOrderedDescending;
    return NSOrderedSame;
  }];
  NSMutableArray *words = [NSMutableArray array];
  for (VNRecognizedTextObservation *line in lines) { VNRecognizedText *text = [line topCandidates:1].firstObject; if (text) [words addObject:text.string]; }
  NSString *visible = [words componentsJoinedByString:@" "];
  NSLog(@"QA_VISIBLE_HEADER expected=%@ recognized=%@ frame=%@",title,visible,NSStringFromCGRect(heading.frame));
  XCTAssertEqualObjects(visible.lowercaseString,title.lowercaseString,@"The pixels must contain the full title, not just its accessibility label.");
  [self waitForStable:app.buttons[@"‹ Games"] app:app];
  [self waitForStable:[self element:@"Sound" app:app] app:app];
  [self waitForStable:app.buttons[@"Open field manual"] app:app];
  [self shot:[@"Shared header " stringByAppendingString:title] app:app];
}
- (void)testSharedHeader {
  XCUIApplication *app = [self library]; [app.buttons[@"Exit replay library"] tap];
  for (NSString *entry in @[@"Open multiplayer uplink",@"Start tactical practice"]) {
    XCUIElement *open = app.buttons[entry]; XCTAssertTrue([open waitForExistenceWithTimeout:20]);
    [self reveal:open inScrollView:app.scrollViews.firstMatch app:app];
    [self waitForStable:open app:app]; [open tap];
    NSString *title = [entry isEqualToString:@"Open multiplayer uplink"] ? @"Multiplayer" : @"Tactical practice";
    [self visibleHeader:title app:app];
    XCUIElement *sound = [self element:@"Sound" app:app]; id original = sound.value;
    [sound tap]; XCTAssertNotEqualObjects(sound.value,original); [sound tap]; XCTAssertEqualObjects(sound.value,original);
    [app.buttons[@"Open field manual"] tap];
    XCTAssertTrue([app.buttons[@"Close field manual"] waitForExistenceWithTimeout:10]); [app.buttons[@"Close field manual"] tap];
    [self waitForStable:[self element:title app:app] app:app];
    [app.buttons[@"‹ Games"] tap];
  }
  XCTAssertTrue([app.buttons[@"Open solo operation"] waitForExistenceWithTimeout:20]);
}
- (XCUIElement *)soloClock:(XCUIApplication *)app prefix:(NSString *)prefix {
  return [app.staticTexts matchingPredicate:[NSPredicate predicateWithFormat:@"label BEGINSWITH %@",prefix]].firstMatch;
}
- (void)measureSolo:(NSString *)scenario app:(XCUIApplication *)app {
  if (!app.buttons[@"Close Solo operation"].exists) { [self waitForStable:app.buttons[@"Setup"] app:app]; [app.buttons[@"Setup"] tap]; }
  XCUIElement *advance = app.buttons[@"Advance simulation +6h"];
  [self reveal:advance inScrollView:app.otherElements[@"operation-drawer"].scrollViews.firstMatch app:app];
  [self waitForStable:advance app:app];
  XCUIElement *clock = [self soloClock:app prefix:@"Live · "];
  XCTAssertTrue(clock.exists); NSString *before = clock.label;
  NSTimeInterval started = NSProcessInfo.processInfo.systemUptime;
  [advance tap]; NSTimeInterval tapReturned = NSProcessInfo.processInfo.systemUptime;
  XCTNSPredicateExpectation *changed = [[XCTNSPredicateExpectation alloc] initWithPredicate:[NSPredicate predicateWithFormat:@"label != %@",before] object:clock];
  XCTAssertEqual([XCTWaiter waitForExpectations:@[changed] timeout:10],XCTWaiterResultCompleted);
  NSLog(@"QA_SOLO_UI scenario=%@ phase=advance before=%@ after=%@ tapReturnedMs=%.3f clockObservedMs=%.3f",scenario,before,clock.label,(tapReturned-started)*1000,(NSProcessInfo.processInfo.systemUptime-started)*1000);
  [self shot:[scenario stringByAppendingString:@" advanced six hours"] app:app];
  [self waitForStable:app.buttons[@"Chart"] app:app]; [app.buttons[@"Chart"] tap];
  XCUIElement *site = [app.buttons matchingPredicate:[NSPredicate predicateWithFormat:@"identifier == %@ AND label CONTAINS %@",@"map-site",@"Mnemosyne,"]].firstMatch;
  [self waitForStable:site app:app]; [site tap];
  XCTAssertTrue([[self element:@"Drones to dispatch" app:app] waitForExistenceWithTimeout:10]);
  [self closeOperationDrawer:app];
  [self waitForStable:app.buttons[@"Time Machine"] app:app]; [app.buttons[@"Time Machine"] tap];
  XCUIElement *future = app.buttons[@"+6h"];
  [self reveal:future inScrollView:app.scrollViews.firstMatch app:app]; [self waitForStable:future app:app];
  started = NSProcessInfo.processInfo.systemUptime; [future tap]; tapReturned = NSProcessInfo.processInfo.systemUptime;
  XCUIElement *forecast = [self soloClock:app prefix:@"Forecast · "];
  XCTAssertTrue([forecast waitForExistenceWithTimeout:10]);
  NSLog(@"QA_SOLO_UI scenario=%@ phase=forecast after=%@ tapReturnedMs=%.3f clockObservedMs=%.3f",scenario,forecast.label,(tapReturned-started)*1000,(NSProcessInfo.processInfo.systemUptime-started)*1000);
  [self shot:[scenario stringByAppendingString:@" forecast six hours"] app:app];
  XCUIElement *now = [app.buttons matchingIdentifier:@"Now"].firstMatch;
  [self waitForStable:now app:app]; [now tap];
  XCTAssertTrue([[self soloClock:app prefix:@"Live · "] waitForExistenceWithTimeout:10]);
  [self waitForStable:app.buttons[@"Close time controls"] app:app]; [app.buttons[@"Close time controls"] tap];
  XCTAssertTrue([app.buttons[@"Time Machine"] waitForExistenceWithTimeout:10]);
}
- (void)testSoloResponsiveness {
  XCUIApplication *app = [self library]; [app.buttons[@"Exit replay library"] tap];
  XCUIElement *solo = app.buttons[@"Open solo operation"];
  [self reveal:solo inScrollView:app.scrollViews.firstMatch app:app]; [self waitForStable:solo app:app]; [solo tap];
  [self measureSolo:@"three-player pulse" app:app];
  [self waitForStable:app.buttons[@"Setup"] app:app]; [app.buttons[@"Setup"] tap];
  XCUIElement *reset = app.buttons[@"Reset"];
  [self reveal:reset inScrollView:app.otherElements[@"operation-drawer"].scrollViews.firstMatch app:app]; [self waitForStable:reset app:app]; [reset tap];
  XCUIElement *replace = app.buttons[@"Replace operation"];
  XCUIElement *dialog = [app.scrollViews containingPredicate:[NSPredicate predicateWithFormat:@"label == %@",@"Replace operation"]].firstMatch;
  XCUIElement *ten = [self element:@"10 players" app:app];
  [self reveal:ten inScrollView:dialog app:app]; [self waitForStable:ten app:app]; [ten tap];
  XCUIElement *mining = [self element:@"Mining" app:app];
  [self reveal:mining inScrollView:dialog app:app]; [self waitForStable:mining app:app]; [mining tap];
  [self reveal:replace inScrollView:dialog app:app]; [self waitForStable:replace app:app]; [replace tap];
  XCTNSPredicateExpectation *closed = [[XCTNSPredicateExpectation alloc] initWithPredicate:[NSPredicate predicateWithFormat:@"exists == NO"] object:replace];
  XCTAssertEqual([XCTWaiter waitForExpectations:@[closed] timeout:10],XCTWaiterResultCompleted);
  XCTAssertTrue([app.staticTexts[@"10 intelligences · mining · target 300 cargo"].firstMatch waitForExistenceWithTimeout:10]);
  [self measureSolo:@"ten-player mining" app:app];
}

@end
