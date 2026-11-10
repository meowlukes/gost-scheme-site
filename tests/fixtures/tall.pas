program Tall;
var a, b, c, d, i, n, s: integer;
begin
  readln(n);
  if n > 0 then
  begin
    a := 1;
    readln(b);
    c := a + b;
    writeln(c);
    d := c * 2;
    readln(a);
    s := a + d;
    writeln(s);
    b := s - 1;
    readln(c);
    d := b + c;
    writeln(d);
    a := d * d;
    readln(b);
    s := a - b;
    writeln(s);
  end
  else
    s := 0;
  while s > 0 do
  begin
    s := s - 1;
    readln(a);
    b := a * 2;
    writeln(b);
    c := b + s;
    readln(d);
    a := c - d;
    writeln(a);
    b := a * a;
    readln(c);
    d := b + c;
    writeln(d);
  end;
  repeat
    n := n - 1;
    readln(a);
    b := a + n;
    writeln(b);
    c := b * 2;
    readln(d);
    a := c + d;
    writeln(a);
    b := a - 1;
    readln(c);
    d := b * c;
    writeln(d);
  until n <= 0;
  writeln(s);
end.
