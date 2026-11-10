program LongOne;
var a, b, c, d, i: integer; x: real;
begin
  readln(a, b);
  c := a + b;
  if c > 10 then d := 1 else d := 2;
  for i := 1 to 10 do
  begin
    c := c + i;
    if c mod 2 = 0 then d := d + 1;
    x := sqrt(c);
    writeln(x);
  end;
  while c > 0 do
  begin
    c := c - 3;
    d := d * 2;
    if d > 1000 then
    begin
      writeln('Ошибка переполнения');
      exit;
    end;
  end;
  repeat
    d := d - 1;
    a := a + d;
    b := b - a;
  until d < 0;
  if a > b then
    if a > c then writeln(a) else writeln(c)
  else if b > c then writeln(b)
  else writeln(c);
  try
    readln(x);
    x := 1 / x;
  except
    writeln('Ошибка ввода');
  end;
  writeln(a, b, c, d);
end.
