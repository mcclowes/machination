#import <React/RCTTextInputComponentView.h>

@interface RCTTextInputComponentView (MachinationInputIdentity)
+ (BOOL)shouldBeRecycled;
@end

@implementation RCTTextInputComponentView (MachinationInputIdentity)
// UIKit can retain a secure accessibility role when a native text field is reused.
+ (BOOL)shouldBeRecycled
{
  return NO;
}
@end
