const {test,expect}=require('@playwright/test');
const phone=require('../phone-number-format.js');
test('phone formatting groups digits without dropping international numbers, extensions, short codes or text',()=>{
 for(const [input,output] of [['',''],['6','6'],['6135','613-5'],['6135551','613-555-1'],['6135551234','613-555-1234'],['16135551234','1-613-555-1234'],['+16135551234','+1-613-555-1234'],['6135551234 x22','613-555-1234 x22'],['6135551234 ext. 123','613-555-1234 ext. 123'],['911','911'],['112','112'],['+44 20 7946 0958','+44 20 7946 0958'],['123456789012345','123456789012345'],['Call site supervisor','Call site supervisor'],['1-800-FLOWERS','1-800-FLOWERS']])expect(phone.format(input),input).toBe(output);
 expect(phone.format('5551234',{final:true})).toBe('555-1234');expect(phone.position('6135551234','613-555-1234',4)).toBe(5);expect(phone.position('6135551234','613-555-1234',0)).toBe(0);
 expect(phone.deletion('613-555-1234',4,4,'Backspace')).toEqual({start:2,end:4});expect(phone.deletion('613-555-1234',3,3,'Delete')).toEqual({start:3,end:5});expect(phone.deletion('613-555-1234 x22',12,12,'Delete')).toEqual({start:12,end:14});expect(phone.deletion('+44 20 7946 0958',3,3,'Delete')).toEqual({start:3,end:3});
});
